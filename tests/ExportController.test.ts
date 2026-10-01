// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/io/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/io/download')>()),
  downloadBlob: vi.fn(),
  downloadText: vi.fn(),
}));

import { ExportController } from '../src/controllers/ExportController';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { DisplayFilter } from '../src/display/DisplayFilter';
import { setLocale } from '../src/i18n';
import { CSV_BOM } from '../src/io/CsvExporter';
import { downloadBlob, downloadText } from '../src/io/download';
import { Point3D } from '../src/math/Point3D';
import type { CadView, CadViewMode } from '../src/ui/CadView';

const doc = Document.instance;
const downloadTextMock = vi.mocked(downloadText);
const downloadBlobMock = vi.mocked(downloadBlob);

const BUTTONS = ['btn-summary', 'btn-export-png', 'btn-export-dxf', 'btn-export-nodes-csv', 'btn-export-elements-csv'];

interface Harness {
  events: string[];
  notices: string[];
  displayFilter: DisplayFilter;
  captureImage: ReturnType<typeof vi.fn>;
  setViewMode(mode: CadViewMode): void;
  click(id: string): void;
}

function createHarness(): Harness {
  const events: string[] = [];
  const notices: string[] = [];
  const displayFilter = new DisplayFilter();
  const captureImage = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
  let viewMode: CadViewMode = 'plan';
  const cadView = {
    displayFilter,
    captureImage,
    get viewMode() {
      return viewMode;
    },
  } as unknown as CadView;
  new ExportController({
    document: doc,
    cadView,
    cancelOperation: () => events.push('cancel'),
    notify: (message) => notices.push(message()),
    root: document,
  }).connect();
  return {
    events,
    notices,
    displayFilter,
    captureImage,
    setViewMode: (mode) => {
      viewMode = mode;
    },
    click: (id) => document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
  };
}

function buildModel(): { upperBeam: Beam } {
  doc.addLayer(new Layer(0, '1F'));
  doc.addLayer(new Layer(3000, '2F / 屋根'));
  const a = new Node(new Point3D(0, 0, 0));
  const b = new Node(new Point3D(6000, 0, 0));
  const c = new Node(new Point3D(0, 0, 3000));
  const d = new Node(new Point3D(6000, 0, 3000));
  const upperBeam = new Beam(c, d);
  doc.addMany([a, b, c, d, new Beam(a, b), upperBeam]);
  doc.filename = 'frame.json';
  return { upperBeam };
}

beforeEach(() => {
  doc.init();
  localStorage.clear();
  setLocale('ja');
  downloadTextMock.mockReset();
  downloadBlobMock.mockReset();
  document.body.innerHTML = BUTTONS.map((id) => `<button id="${id}"></button>`).join('');
});

afterEach(() => {
  if (document.querySelector('.modal-overlay')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  vi.restoreAllMocks();
});

describe('ExportController', () => {
  it('uses a real byte order mark so spreadsheets detect UTF-8', () => {
    expect(CSV_BOM).toHaveLength(1);
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
  });

  it('saves node and element CSV files with a BOM, named after the model', async () => {
    buildModel();
    const harness = createHarness();

    harness.click('btn-export-nodes-csv');
    harness.click('btn-export-elements-csv');
    await vi.waitFor(() => expect(downloadTextMock).toHaveBeenCalledTimes(2));

    const [nodes, elements] = downloadTextMock.mock.calls;
    expect(nodes[0]).toBe('frame_nodes.csv');
    expect(nodes[1].startsWith(`${CSV_BOM}number,x_mm,y_mm,z_mm\r\n`)).toBe(true);
    expect(nodes[2]).toBe('text/csv;charset=utf-8');
    expect(elements[0]).toBe('frame_elements.csv');
    expect(elements[1]).toContain('beam,1,G1,2 3,6000,');
    expect(harness.notices).toEqual(['frame_nodes.csv を保存しました', 'frame_elements.csv を保存しました']);
    // 出力のたびに、未確定の作図状態を先に破棄する。
    expect(harness.events).toEqual(['cancel', 'cancel']);
  });

  it('exports the shown storey in plan view and the whole model otherwise', async () => {
    const { upperBeam } = buildModel();
    const harness = createHarness();
    doc.shownLayer = doc.layers[1];

    harness.click('btn-export-dxf');
    await vi.waitFor(() => expect(downloadTextMock).toHaveBeenCalledTimes(1));
    const [planName, planDxf, type] = downloadTextMock.mock.calls[0];
    // 階名に含まれる、ファイル名に使えない文字と空白は置き換える。
    expect(planName).toBe('frame_2F_屋根.dxf');
    expect(type).toBe('application/dxf');
    expect(planDxf.match(/\r\nLINE\r\n/g)).toHaveLength(1);
    expect(planDxf.match(/\r\nPOINT\r\n/g)).toHaveLength(2);

    harness.setViewMode('3d');
    harness.click('btn-export-dxf');
    await vi.waitFor(() => expect(downloadTextMock).toHaveBeenCalledTimes(2));
    const [modelName, modelDxf] = downloadTextMock.mock.calls[1];
    expect(modelName).toBe('frame.dxf');
    expect(modelDxf.match(/\r\nLINE\r\n/g)).toHaveLength(2);

    // 非表示にした要素と非表示レイヤーの要素は出力しない。
    harness.displayFilter.hide(upperBeam);
    doc.updateLayer(doc.layers[0], { visible: false });
    harness.click('btn-export-dxf');
    await vi.waitFor(() => expect(downloadTextMock).toHaveBeenCalledTimes(3));
    expect(downloadTextMock.mock.calls[2][1].match(/\r\nLINE\r\n/g)).toBeNull();
  });

  it('saves the captured view as PNG and reports capture failures', async () => {
    buildModel();
    const harness = createHarness();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    harness.click('btn-export-png');
    await vi.waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    expect(downloadBlobMock.mock.calls[0][0]).toBe('frame.png');
    expect(downloadBlobMock.mock.calls[0][1].type).toBe('image/png');
    expect(harness.notices).toEqual(['frame.png を保存しました']);

    harness.captureImage.mockRejectedValueOnce(new Error('context lost'));
    harness.click('btn-export-png');
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledWith('出力に失敗しました: context lost'));
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
  });

  it('opens the quantity summary and saves its CSV with localized headers', async () => {
    buildModel();
    doc.filename = '';
    const harness = createHarness();

    harness.click('btn-summary');
    await vi.waitFor(() => expect(document.querySelector('.modal-dialog')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.button-row button')!.click();

    expect(downloadTextMock).toHaveBeenCalledTimes(1);
    const [name, csv] = downloadTextMock.mock.calls[0];
    expect(name).toBe('model_summary.csv');
    expect(csv).toBe(`${CSV_BOM}種別,断面,数,延長 (m),面積 (m²)\r\n梁,G1,2,12,\r\n合計,,2,12,0\r\n`);
    expect(harness.notices).toEqual(['model_summary.csv を保存しました']);
  });
});
