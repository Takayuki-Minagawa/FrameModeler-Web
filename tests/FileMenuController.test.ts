// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/history/DraftStore', () => ({
  clearDraft: vi.fn(async () => undefined),
  clearDraftFamily: vi.fn(async () => undefined),
  loadDraft: vi.fn(async () => null),
  saveDraft: vi.fn(async () => undefined),
}));
vi.mock('../src/io/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/io/download')>()),
  downloadText: vi.fn(),
}));
vi.mock('../src/ui/dialogs/MessageDialog', () => ({
  showMessageDialog: vi.fn(async () => undefined),
  showConfirmDialog: vi.fn(async () => true),
  showChoiceDialog: vi.fn(async () => null),
}));
vi.mock('../src/ui/dialogs/SaveFilenameDialog', () => ({ showSaveFilenameDialog: vi.fn(async () => 'model.json') }));

import { AppController } from '../src/controllers/AppController';
import { FileController } from '../src/controllers/FileController';
import { FileMenuController, type SaveFilePicker } from '../src/controllers/FileMenuController';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { setLocale } from '../src/i18n';
import { downloadText } from '../src/io/download';
import { serializeJson } from '../src/io/JsonSerializer';
import { Point3D } from '../src/math/Point3D';
import type { CadView } from '../src/ui/CadView';
import { showConfirmDialog, showMessageDialog } from '../src/ui/dialogs/MessageDialog';
import { showSaveFilenameDialog } from '../src/ui/dialogs/SaveFilenameDialog';

const doc = Document.instance;
const downloadTextMock = vi.mocked(downloadText);
const confirmDialog = vi.mocked(showConfirmDialog);
const messageDialog = vi.mocked(showMessageDialog);
const saveFilenameDialog = vi.mocked(showSaveFilenameDialog);

interface Harness {
  controller: FileMenuController;
  app: AppController;
  events: string[];
  fileInput: HTMLInputElement;
  importInfoButton: HTMLButtonElement;
}

function createHarness(savePicker: SaveFilePicker | null = null): Harness {
  document.body.innerHTML = `
    <button id="btn-new"></button><button id="btn-open"></button><button id="btn-save"></button>
    <button id="btn-validate"></button><button id="btn-import-info"></button><input id="file-input" type="file" />
  `;
  const events: string[] = [];
  const refreshDocument = (fit: boolean): void => void events.push(`refresh:${fit}`);
  const app = new AppController({ document: doc, cancelOperation: () => events.push('cancel'), refreshDocument });
  const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
  const importInfoButton = document.querySelector<HTMLButtonElement>('#btn-import-info')!;
  const controller = new FileMenuController({
    document: doc,
    appController: app,
    fileController: new FileController(doc),
    cadView: { renderSelection: vi.fn(), fitToData: vi.fn() } as unknown as CadView,
    fileInput,
    importInfoButton,
    cancelOperation: () => events.push('cancel'),
    refreshDocument,
    notify: (message) => events.push(`notify:${message()}`),
    root: document,
    savePicker,
  });
  controller.connect();
  return { controller, app, events, fileInput, importInfoButton };
}

function addBeam(): void {
  const a = new Node(new Point3D(0, 0, 0));
  const b = new Node(new Point3D(1000, 0, 0));
  doc.addMany([a, b, new Beam(a, b)]);
}

beforeEach(() => {
  doc.init();
  localStorage.clear();
  setLocale('ja');
  downloadTextMock.mockReset();
  confirmDialog.mockReset();
  confirmDialog.mockResolvedValue(true);
  messageDialog.mockReset();
  messageDialog.mockResolvedValue(undefined);
  saveFilenameDialog.mockReset();
  saveFilenameDialog.mockResolvedValue('model.json');
});

afterEach(() => {
  if (document.querySelector('.modal-overlay')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  vi.restoreAllMocks();
});

describe('FileMenuController', () => {
  it('protects unsaved changes on New and Open', async () => {
    const harness = createHarness();
    confirmDialog.mockResolvedValue(false);
    const pickFile = vi.spyOn(harness.fileInput, 'click').mockImplementation(() => {});

    // 変更が無ければ確認せずに進む。
    await harness.controller.requestOpen();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(pickFile).toHaveBeenCalledTimes(1);

    await harness.app.performTrackedChange('history.addBeam', addBeam);
    expect(harness.app.isDirty).toBe(true);

    await harness.controller.newDocument();
    expect(confirmDialog).toHaveBeenLastCalledWith('現在のデータを破棄して新規作成しますか？', {
      okLabel: '新規',
      danger: true,
    });
    expect(doc.allDataList).toHaveLength(3);

    await harness.controller.requestOpen();
    expect(confirmDialog).toHaveBeenLastCalledWith('未保存の変更を破棄してファイルを開きますか？', {
      okLabel: '開く',
      danger: true,
    });
    expect(pickFile).toHaveBeenCalledTimes(1);

    confirmDialog.mockResolvedValue(true);
    harness.events.length = 0;
    document.querySelector<HTMLButtonElement>('#btn-new')!.click();
    await vi.waitFor(() => expect(doc.allDataList).toHaveLength(0));
    // 新規作成後は既定レイヤー 1F だけを持つ。
    expect(doc.layers.map((layer) => layer.name)).toEqual(['1F']);
    expect(harness.app.isDirty).toBe(false);
    expect(harness.app.history.canUndo).toBe(false);
    expect(harness.events).toEqual(['cancel', 'refresh:false']);
  });

  it('opens a JSON file as a clean document and restores the model when the file is invalid', async () => {
    addBeam();
    const json = serializeJson();
    doc.init();
    const harness = createHarness();

    await harness.controller.openFile(new File([json], 'frame.json', { type: 'application/json' }));
    expect(doc.memberList).toHaveLength(1);
    expect(doc.filename).toBe('frame.json');
    expect(harness.app.isDirty).toBe(false);
    expect(harness.events.at(-1)).toBe('refresh:true');
    expect(harness.importInfoButton.disabled).toBe(true);

    await harness.controller.openFile(new File(['{ "schemaVersion": 2, "nodes": 1 }'], 'broken.json'));
    expect(messageDialog.mock.calls[0][0]).toMatch(/^ファイル読込エラー: /);
    expect(messageDialog.mock.calls[0][1]).toEqual({ level: 'error' });
    expect(doc.memberList).toHaveLength(1);
    expect(doc.filename).toBe('frame.json');

    await harness.controller.openFile(new File(['plain text'], 'notes.txt'));
    expect(messageDialog).toHaveBeenCalledTimes(2);
    expect(doc.memberList).toHaveLength(1);
  });

  it('saves a valid model as a download with a confirmed file name and marks it clean', async () => {
    const harness = createHarness();
    await harness.app.performTrackedChange('history.addBeam', addBeam);
    doc.filename = 'pillar_test.json';
    saveFilenameDialog.mockResolvedValueOnce('frame-v2.json');

    document.querySelector<HTMLButtonElement>('#btn-save')!.click();
    await vi.waitFor(() => expect(downloadTextMock).toHaveBeenCalledTimes(1));
    // 読み込んだファイル名を既定値として提示し、入力された名前で保存する。
    expect(saveFilenameDialog).toHaveBeenCalledWith('pillar_test.json');
    expect(downloadTextMock.mock.calls[0][0]).toBe('frame-v2.json');
    expect(JSON.parse(downloadTextMock.mock.calls[0][1]).beams).toHaveLength(1);
    expect(doc.filename).toBe('frame-v2.json');
    expect(harness.app.isDirty).toBe(false);
    expect(harness.events).toContain('cancel');
    expect(harness.events).toContain('notify:frame-v2.json を保存しました');

    // ファイル名ダイアログを取り消すと保存しない。
    saveFilenameDialog.mockResolvedValueOnce(null);
    await harness.app.performTrackedChange('history.addBeam', addBeam);
    await harness.controller.save();
    expect(downloadTextMock).toHaveBeenCalledTimes(1);
    expect(harness.app.isDirty).toBe(true);
  });

  it('writes through the File System Access API when available and overwrites the same file afterwards', async () => {
    const written: string[] = [];
    const handle = {
      name: 'site.json',
      createWritable: async () => ({
        write: async (data: string) => void written.push(data),
        close: async () => undefined,
      }),
    };
    const picker = vi.fn<SaveFilePicker>(async () => handle);
    const harness = createHarness(picker);
    await harness.app.performTrackedChange('history.addBeam', addBeam);

    await harness.controller.save();
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0][0]).toMatchObject({ suggestedName: 'model.json' });
    expect(written).toHaveLength(1);
    expect(doc.filename).toBe('site.json');
    expect(harness.app.isDirty).toBe(false);
    expect(saveFilenameDialog).not.toHaveBeenCalled();
    expect(downloadTextMock).not.toHaveBeenCalled();

    // 2回目以降は保存先を聞かずに同じファイルへ上書きする。
    await harness.app.performTrackedChange('history.addBeam', addBeam);
    await harness.controller.save();
    expect(picker).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(2);

    // 利用者が保存先の選択を取り消したら何もしない。
    await harness.controller.newDocument();
    await harness.app.performTrackedChange('history.addBeam', addBeam);
    picker.mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    await harness.controller.save();
    expect(written).toHaveLength(2);
    expect(saveFilenameDialog).not.toHaveBeenCalled();
    expect(harness.app.isDirty).toBe(true);
  });

  it('shows the validation dialog from the Validate button', async () => {
    createHarness();
    addBeam();
    document.querySelector<HTMLButtonElement>('#btn-validate')!.click();
    await vi.waitFor(() => expect(document.querySelector('.modal-dialog h3')?.textContent).toBe('モデル検証'));
  });
});
