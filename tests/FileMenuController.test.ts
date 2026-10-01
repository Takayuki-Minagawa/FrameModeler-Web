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

import { AppController } from '../src/controllers/AppController';
import { FileController } from '../src/controllers/FileController';
import { FileMenuController } from '../src/controllers/FileMenuController';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { setLocale } from '../src/i18n';
import { downloadText } from '../src/io/download';
import { serializeJson } from '../src/io/JsonSerializer';
import { Point3D } from '../src/math/Point3D';
import type { CadView } from '../src/ui/CadView';

const doc = Document.instance;
const downloadTextMock = vi.mocked(downloadText);

interface Harness {
  controller: FileMenuController;
  app: AppController;
  events: string[];
  fileInput: HTMLInputElement;
  importInfoButton: HTMLButtonElement;
}

function createHarness(): Harness {
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
    root: document,
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
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const pickFile = vi.spyOn(harness.fileInput, 'click').mockImplementation(() => {});

    // 変更が無ければ確認せずに進む。
    document.querySelector<HTMLButtonElement>('#btn-open')!.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pickFile).toHaveBeenCalledTimes(1);

    await harness.app.performTrackedChange('history.addBeam', addBeam);
    expect(harness.app.isDirty).toBe(true);

    document.querySelector<HTMLButtonElement>('#btn-new')!.click();
    expect(confirmSpy).toHaveBeenLastCalledWith('現在のデータを破棄して新規作成しますか？');
    expect(doc.allDataList).toHaveLength(3);

    document.querySelector<HTMLButtonElement>('#btn-open')!.click();
    expect(confirmSpy).toHaveBeenLastCalledWith('未保存の変更を破棄してファイルを開きますか？');
    expect(pickFile).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValue(true);
    harness.events.length = 0;
    document.querySelector<HTMLButtonElement>('#btn-new')!.click();
    expect(doc.allDataList).toHaveLength(0);
    expect(harness.app.isDirty).toBe(false);
    expect(harness.app.history.canUndo).toBe(false);
    expect(harness.events).toEqual(['cancel', 'refresh:false']);
  });

  it('opens a JSON file as a clean document and restores the model when the file is invalid', async () => {
    addBeam();
    const json = serializeJson();
    doc.init();
    const harness = createHarness();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await harness.controller.openFile(new File([json], 'frame.json', { type: 'application/json' }));
    expect(doc.memberList).toHaveLength(1);
    expect(doc.filename).toBe('frame.json');
    expect(harness.app.isDirty).toBe(false);
    expect(harness.events.at(-1)).toBe('refresh:true');
    expect(harness.importInfoButton.disabled).toBe(true);

    await harness.controller.openFile(new File(['{ "schemaVersion": 2, "nodes": 1 }'], 'broken.json'));
    expect(alertSpy.mock.calls[0][0]).toMatch(/^ファイル読込エラー: /);
    expect(doc.memberList).toHaveLength(1);
    expect(doc.filename).toBe('frame.json');

    await harness.controller.openFile(new File(['plain text'], 'notes.txt'));
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(doc.memberList).toHaveLength(1);
  });

  it('saves a valid model and marks it clean', async () => {
    const harness = createHarness();
    await harness.app.performTrackedChange('history.addBeam', addBeam);

    document.querySelector<HTMLButtonElement>('#btn-save')!.click();
    expect(downloadTextMock).toHaveBeenCalledTimes(1);
    expect(downloadTextMock.mock.calls[0][0]).toBe('model.json');
    expect(JSON.parse(downloadTextMock.mock.calls[0][1]).beams).toHaveLength(1);
    expect(harness.app.isDirty).toBe(false);
    expect(harness.events).toContain('cancel');
  });

  it('shows the validation dialog from the Validate button', async () => {
    createHarness();
    addBeam();
    document.querySelector<HTMLButtonElement>('#btn-validate')!.click();
    await vi.waitFor(() => expect(document.querySelector('.modal-dialog h3')?.textContent).toBe('モデル検証'));
  });
});
