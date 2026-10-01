import type { Document } from '../data/Document';
import { inspectModel, type ModelIssue } from '../data/ModelInspector';
import { clearDraft } from '../history/DraftStore';
import { t } from '../i18n';
import type { CadView } from '../ui/CadView';
import { showCalcYamlImportModeDialog } from '../ui/dialogs/CalcYamlImportModeDialog';
import { showImportInfoDialog } from '../ui/dialogs/ImportInfoDialog';
import { showModelValidationDialog } from '../ui/dialogs/ModelValidationDialog';
import { sameSnapshot, type AppController } from './AppController';
import type { FileController } from './FileController';

export interface FileMenuControllerOptions {
  document: Document;
  appController: AppController;
  fileController: FileController;
  cadView: CadView;
  fileInput: HTMLInputElement;
  importInfoButton: HTMLButtonElement;
  cancelOperation: () => void;
  refreshDocument: (fit: boolean) => void;
  root?: globalThis.Document;
}

/** 新規・開く・保存・検証・読込情報の操作フローを、未保存変更の保護とともに管理する。 */
export class FileMenuController {
  private readonly root: globalThis.Document;

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

  newDocument(): void {
    const { appController, fileController, cancelOperation, refreshDocument } = this.options;
    cancelOperation();
    if (appController.isDirty && !confirm(t('msg.confirmNew'))) return;
    appController.withoutHistory(() => fileController.reset());
    appController.resetHistory(true);
    void clearDraft();
    refreshDocument(false);
  }

  requestOpen(): void {
    this.options.cancelOperation();
    if (this.options.appController.isDirty && !confirm(t('msg.confirmOpen'))) return;
    this.options.fileInput.click();
  }

  async openFile(file: File): Promise<void> {
    const { document: doc, appController, fileController, refreshDocument } = this.options;
    const beforeOpen = appController.capture();
    try {
      const content = await readFileText(file);
      const opened = await appController.withoutHistoryAsync(() =>
        fileController.openText(file.name, content, showCalcYamlImportModeDialog),
      );
      if (!opened) return;
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
      alert(t('msg.fileError') + (error as Error).message);
    }
  }

  save(): void {
    const { document: doc, appController, fileController, cancelOperation } = this.options;
    // 移動previewなどDocument未確定の一時状態は保存しない。
    cancelOperation();
    const issues = inspectModel(doc);
    if (issues.some((issue) => issue.severity === 'error')) {
      void showModelValidationDialog(issues, (issue) => this.selectTargets(issue));
      return;
    }
    fileController.save();
    appController.markSaved();
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
