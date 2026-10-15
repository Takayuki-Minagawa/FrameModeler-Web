import type { Document } from '../data/Document';
import { inspectModel, type ModelIssue } from '../data/ModelInspector';
import { clearDraft } from '../history/DraftStore';
import { t } from '../i18n';
import { serializeJson } from '../io/JsonSerializer';
import type { CadView } from '../ui/CadView';
import { showCalcYamlImportModeDialog } from '../ui/dialogs/CalcYamlImportModeDialog';
import { showImportInfoDialog } from '../ui/dialogs/ImportInfoDialog';
import { showConfirmDialog, showMessageDialog } from '../ui/dialogs/MessageDialog';
import { showModelValidationDialog } from '../ui/dialogs/ModelValidationDialog';
import { showSaveFilenameDialog } from '../ui/dialogs/SaveFilenameDialog';
import { sameSnapshot, type AppController } from './AppController';
import { toJsonFilename, type FileController } from './FileController';

export interface FileMenuControllerOptions {
  document: Document;
  appController: AppController;
  fileController: FileController;
  cadView: CadView;
  fileInput: HTMLInputElement;
  importInfoButton: HTMLButtonElement;
  cancelOperation: () => void;
  refreshDocument: (fit: boolean) => void;
  /** 保存結果などの短い通知。 */
  notify?: (message: () => string) => void;
  root?: globalThis.Document;
  /** File System Access API の有無をテストから差し替えるための注入点。 */
  savePicker?: SaveFilePicker | null;
}

/** File System Access API の showSaveFilePicker。lib.dom には含まれないため最小限の型を定義する。 */
export interface SaveFilePicker {
  (options: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }): Promise<WritableFileHandle>;
}

export interface WritableFileHandle {
  readonly name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** 新規・開く・保存・検証・読込情報の操作フローを、未保存変更の保護とともに管理する。 */
export class FileMenuController {
  private readonly root: globalThis.Document;
  /** showSaveFilePicker で得た保存先。同じモデルを続けて保存するときは上書きする。 */
  private fileHandle: WritableFileHandle | null = null;
  private saving = false;

  constructor(private readonly options: FileMenuControllerOptions) {
    this.root = options.root ?? document;
  }

  connect(): void {
    const bind = (id: string, action: () => unknown): void => {
      this.root.getElementById(id)?.addEventListener('click', () => void action());
    };
    bind('btn-new', () => this.newDocument());
    bind('btn-open', () => this.requestOpen());
    bind('btn-save', () => this.save());
    bind('btn-validate', () => this.validate());
    this.options.importInfoButton.addEventListener('click', () => void this.showImportInfo());
    this.options.fileInput.addEventListener('change', () => {
      const file = this.options.fileInput.files?.[0];
      // 同じファイルを再度選択できるようリセットする。
      this.options.fileInput.value = '';
      if (file) void this.openFile(file);
    });
    this.updateImportInfoButton();
  }

  async newDocument(): Promise<void> {
    const { appController, fileController, cancelOperation, refreshDocument } = this.options;
    cancelOperation();
    if (appController.isDirty && !(await showConfirmDialog(t('msg.confirmNew'), { okLabel: t('new'), danger: true }))) {
      return;
    }
    this.fileHandle = null;
    appController.withoutHistory(() => fileController.reset());
    appController.resetHistory(true);
    void clearDraft();
    refreshDocument(false);
  }

  async requestOpen(): Promise<void> {
    this.options.cancelOperation();
    if (
      this.options.appController.isDirty &&
      !(await showConfirmDialog(t('msg.confirmOpen'), { okLabel: t('open'), danger: true }))
    ) {
      return;
    }
    this.options.fileInput.click();
  }

  async openFile(file: File): Promise<void> {
    const content = await readFileText(file).catch((error: unknown) => {
      void showMessageDialog(t('msg.fileError') + (error as Error).message, { level: 'error' });
      return null;
    });
    if (content === null) return;
    await this.openText(file.name, content);
  }

  /** URL パラメータ ?file= などから、ネットワーク越しにモデルを読み込む。 */
  async openFromUrl(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const name = decodeURIComponent(new URL(url, this.root.baseURI).pathname.split('/').pop() || 'model.json');
      await this.openText(name, await response.text());
    } catch (error) {
      await showMessageDialog(t('msg.fileError') + (error as Error).message, { level: 'error' });
    }
  }

  async openText(name: string, content: string): Promise<void> {
    const { document: doc, appController, fileController, refreshDocument } = this.options;
    const beforeOpen = appController.capture();
    try {
      const opened = await appController.withoutHistoryAsync(() =>
        fileController.openText(name, content, showCalcYamlImportModeDialog),
      );
      if (!opened) return;
      this.fileHandle = null;
      appController.resetHistory(true);
      void clearDraft();
      refreshDocument(true);
      if (doc.importMetadata) await showImportInfoDialog(doc.importMetadata);
    } catch (error) {
      // JSON/YAML parserはcommit前検証を行う。モデルが実際に変わった場合だけ戻し、
      // 単純なparse失敗では選択状態とオブジェクト同一性を保持する。
      try {
        if (!sameSnapshot(appController.capture(), beforeOpen)) appController.restoreSnapshot(beforeOpen);
      } catch {
        appController.restoreSnapshot(beforeOpen);
      }
      await showMessageDialog(t('msg.fileError') + (error as Error).message, { level: 'error' });
    }
  }

  /**
   * 保存。File System Access API が使えるブラウザでは保存先を選び、以後は同じファイルへ上書きする。
   * 使えないブラウザではファイル名を確認してダウンロードする。読み込んだファイル名を既定値にする。
   */
  async save(): Promise<void> {
    const { document: doc, appController, fileController, cancelOperation } = this.options;
    if (this.saving) return;
    // 移動previewなどDocument未確定の一時状態は保存しない。
    cancelOperation();
    const issues = inspectModel(doc);
    if (issues.some((issue) => issue.severity === 'error')) {
      void showModelValidationDialog(issues, (issue) => this.selectTargets(issue));
      return;
    }
    this.saving = true;
    try {
      const suggested = doc.hasFileName ? toJsonFilename(doc.filename) : 'model.json';
      const picker = this.savePicker;
      if (picker) {
        const saved = await this.saveWithPicker(picker, suggested);
        if (saved === 'cancelled') return;
        if (saved) {
          appController.markSaved();
          this.options.notify?.(() => t('msg.exported', { name: saved }));
          return;
        }
        // picker が使えなかった場合はダウンロードへ切り替える。
      }
      const name = await showSaveFilenameDialog(suggested);
      if (!name) return;
      const filename = fileController.save(name);
      appController.markSaved();
      this.options.notify?.(() => t('msg.exported', { name: filename }));
    } finally {
      this.saving = false;
    }
  }

  validate(): void {
    this.options.cancelOperation();
    void showModelValidationDialog(inspectModel(this.options.document), (issue) => this.selectTargets(issue));
  }

  async showImportInfo(): Promise<void> {
    const metadata = this.options.document.importMetadata;
    if (metadata) await showImportInfoDialog(metadata);
  }

  updateImportInfoButton(): void {
    this.options.importInfoButton.disabled = !this.options.document.importMetadata;
  }

  private get savePicker(): SaveFilePicker | null {
    if (this.options.savePicker !== undefined) return this.options.savePicker;
    const view = this.root.defaultView as (Window & { showSaveFilePicker?: SaveFilePicker }) | null;
    return typeof view?.showSaveFilePicker === 'function' ? view.showSaveFilePicker.bind(view) : null;
  }

  /** 戻り値: 保存したファイル名、利用者が取り消したら 'cancelled'、API が失敗したら null。 */
  private async saveWithPicker(picker: SaveFilePicker, suggestedName: string): Promise<string | 'cancelled' | null> {
    try {
      const handle =
        this.fileHandle ??
        (await picker({
          suggestedName,
          types: [{ description: 'FrameModeler JSON', accept: { 'application/json': ['.json'] } }],
        }));
      const writable = await handle.createWritable();
      await writable.write(serializeJson());
      await writable.close();
      this.fileHandle = handle;
      this.options.document.filename = handle.name;
      return handle.name;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'cancelled';
      this.fileHandle = null;
      return null;
    }
  }

  private selectTargets(issue: ModelIssue): void {
    const targets = new Set(issue.targets);
    for (const data of this.options.document.allDataList) data.select = targets.has(data);
    this.options.cadView.renderSelection();
    this.options.cadView.fitToData(issue.targets);
  }
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(t('msg.fileReadFailed')));
    reader.readAsText(file);
  });
}
