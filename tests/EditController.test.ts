// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/dialogs/ArrayCopyDialog', () => ({ showArrayCopyDialog: vi.fn() }));
vi.mock('../src/ui/dialogs/MergeNodesDialog', () => ({ showMergeNodesDialog: vi.fn() }));

import { EditController } from '../src/controllers/EditController';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import type { DocumentData } from '../src/data/DocumentData';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { Pillar } from '../src/data/Pillar';
import { DisplayFilter } from '../src/display/DisplayFilter';
import { setLocale } from '../src/i18n';
import { Point3D } from '../src/math/Point3D';
import { SelectionFilter } from '../src/selection/SelectionFilter';
import type { CadView, CadViewMode } from '../src/ui/CadView';
import { showArrayCopyDialog } from '../src/ui/dialogs/ArrayCopyDialog';
import { showMergeNodesDialog } from '../src/ui/dialogs/MergeNodesDialog';

const doc = Document.instance;
const arrayCopyDialog = vi.mocked(showArrayCopyDialog);
const mergeNodesDialog = vi.mocked(showMergeNodesDialog);

interface Harness {
  controller: EditController;
  selectionFilter: SelectionFilter;
  displayFilter: DisplayFilter;
  events: string[];
  notices: string[];
  setViewMode(mode: CadViewMode): void;
}

function createHarness(): Harness {
  const events: string[] = [];
  const notices: string[] = [];
  const selectionFilter = new SelectionFilter();
  const displayFilter = new DisplayFilter();
  let viewMode: CadViewMode = 'plan';
  const cadView = {
    displayFilter,
    get viewMode() {
      return viewMode;
    },
    renderSelection: () => events.push('renderSelection'),
  } as unknown as CadView;
  const controller = new EditController({
    document: doc,
    cadView,
    selectionFilter,
    trackChange: async (label, action) => {
      events.push(`track:${label}`);
      return await action();
    },
    cancelOperation: () => events.push('cancel'),
    refreshDocument: () => events.push('refresh'),
    notify: (message) => notices.push(message()),
    root: document,
  });
  controller.connect();
  return {
    controller,
    selectionFilter,
    displayFilter,
    events,
    notices,
    setViewMode: (mode) => {
      viewMode = mode;
    },
  };
}

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

function selected(): DocumentData[] {
  return doc.allDataList.filter((data) => data.select);
}

/** 2層の門型フレーム。lower=1F、upper=2F。 */
function buildFrame(): { lower: Layer; upper: Layer; base: Node[]; top: Node[]; beam: Beam; pillars: Pillar[] } {
  const lower = new Layer(0, '1F');
  const upper = new Layer(3000, '2F');
  doc.addLayer(lower);
  doc.addLayer(upper);
  const base = [node(0, 0), node(6000, 0)];
  const top = [node(0, 0, 3000), node(6000, 0, 3000)];
  const beam = new Beam(top[0], top[1]);
  const pillars = [new Pillar(base[0], top[0]), new Pillar(base[1], top[1])];
  doc.addMany([...base, ...top, beam, ...pillars]);
  doc.shownLayer = lower;
  return { lower, upper, base, top, beam, pillars };
}

beforeEach(() => {
  doc.init();
  localStorage.clear();
  setLocale('ja');
  arrayCopyDialog.mockReset();
  mergeNodesDialog.mockReset();
  document.body.innerHTML = `
    <button id="btn-delete"></button>
    <button id="btn-select-all"></button>
    <button id="btn-invert-selection"></button>
    <button id="btn-array-copy"></button>
    <button id="btn-merge-nodes"></button>
    <button id="btn-remove-orphans"></button>
    <input type="checkbox" data-selection-kind="node" checked />
    <input type="checkbox" data-selection-kind="beam" checked />
    <input type="checkbox" data-selection-kind="pillar" checked />
  `;
});

afterEach(() => vi.restoreAllMocks());

describe('EditController selection', () => {
  it('selects everything on the shown layer in plan view and the whole model otherwise', () => {
    const { base, pillars, upper } = buildFrame();
    const harness = createHarness();

    document.querySelector<HTMLButtonElement>('#btn-select-all')!.click();
    expect(new Set(selected())).toEqual(new Set([...base, ...pillars]));
    expect(harness.events).toContain('renderSelection');

    harness.setViewMode('3d');
    harness.controller.selectAll();
    expect(selected()).toHaveLength(doc.allDataList.length);

    // 平面表示へ戻すと、表示階に無い要素の選択は解除される。
    harness.setViewMode('plan');
    doc.shownLayer = upper;
    harness.controller.selectAll();
    expect(selected().some((data) => base.includes(data as Node))).toBe(false);
    expect(selected()).toHaveLength(5);
  });

  it('respects the selection filter, display filter, hidden layers and locked layers', () => {
    const { base, beam, pillars, upper, top } = buildFrame();
    const harness = createHarness();
    harness.setViewMode('3d');

    harness.selectionFilter.enableOnly('node');
    harness.controller.selectAll();
    expect(new Set(selected())).toEqual(new Set([...base, ...top]));

    harness.selectionFilter.reset();
    harness.displayFilter.hide(base[0]);
    harness.controller.selectAll();
    expect(selected()).not.toContain(base[0]);
    harness.displayFilter.showAll();

    doc.updateLayer(upper, { locked: true });
    harness.controller.selectAll();
    // 2F にまたがる梁・柱・2F節点はロック対象。
    expect(new Set(selected())).toEqual(new Set(base));

    doc.updateLayer(upper, { locked: false, visible: false });
    harness.controller.selectAll();
    expect(selected()).not.toContain(beam);
    expect(selected()).toEqual(expect.arrayContaining([...base, ...pillars]));
  });

  it('inverts only selectable elements and leaves the rest untouched', () => {
    const { base, pillars, beam } = buildFrame();
    const harness = createHarness();
    base[0].select = true;
    beam.select = true; // 2F の要素は平面表示(1F)では対象外

    document.querySelector<HTMLButtonElement>('#btn-invert-selection')!.click();
    expect(new Set(selected())).toEqual(new Set([base[1], ...pillars, beam]));
    expect(harness.events.filter((event) => event === 'renderSelection')).toHaveLength(1);
  });

  it('applies the selection-kind checkboxes and drops selections that are no longer allowed', () => {
    const { base, pillars } = buildFrame();
    const harness = createHarness();
    harness.controller.selectAll();

    const pillarBox = document.querySelector<HTMLInputElement>('[data-selection-kind="pillar"]')!;
    pillarBox.checked = false;
    pillarBox.dispatchEvent(new Event('change'));
    expect(new Set(selected())).toEqual(new Set(base));
    expect(harness.selectionFilter.allows(pillars[0])).toBe(false);

    pillarBox.checked = true;
    pillarBox.dispatchEvent(new Event('change'));
    expect(harness.selectionFilter.settings.all).toBe(true);
  });
});

describe('EditController delete', () => {
  it('does nothing without a selection and asks before deleting', async () => {
    const { beam } = buildFrame();
    const harness = createHarness();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await harness.controller.deleteSelection();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(harness.events).toEqual(['cancel']);

    beam.select = true;
    await harness.controller.deleteSelection();
    expect(confirmSpy).toHaveBeenCalledWith('選択した1要素を削除しますか？');
    expect(doc.allDataList).toContain(beam);

    confirmSpy.mockReturnValue(true);
    await harness.controller.deleteSelection();
    expect(doc.allDataList).not.toContain(beam);
    expect(harness.events.slice(-2)).toEqual(['track:history.deleteSelection', 'refresh']);
  });

  it('explains which elements still reference a selected node, in the current language', async () => {
    const { top } = buildFrame();
    const harness = createHarness();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    top[0].select = true;

    await harness.controller.deleteSelection();
    expect(alertSpy.mock.calls[0][0]).toContain('節点 2 は 梁 0 から参照されています');
    expect(alertSpy.mock.calls[0][0]).toContain('節点 2 は 柱 1 から参照されています');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(doc.nodeList).toHaveLength(4);

    setLocale('en');
    await harness.controller.deleteSelection();
    expect(alertSpy.mock.calls[1][0]).toContain('Node 2 is referenced by Beam 0');
  });

  it('reports a failed delete without refreshing', async () => {
    const { upper, beam } = buildFrame();
    const harness = createHarness();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    doc.updateLayer(upper, { locked: true });
    beam.select = true;

    await harness.controller.deleteSelection();
    expect(alertSpy.mock.calls[0][0]).toMatch(/^削除できませんでした:/);
    expect(doc.allDataList).toContain(beam);
    expect(harness.events).not.toContain('refresh');
  });
});

describe('EditController array copy', () => {
  it('requires a selection before opening the dialog', async () => {
    buildFrame();
    const harness = createHarness();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await harness.controller.arrayCopy();
    expect(alertSpy).toHaveBeenCalledWith('要素が選択されていません。');
    expect(arrayCopyDialog).not.toHaveBeenCalled();
  });

  it('copies the selection, reports the result and remembers the last input', async () => {
    const { beam, pillars } = buildFrame();
    const harness = createHarness();
    beam.select = true;
    pillars.forEach((pillar) => (pillar.select = true));
    const input = { offset: new Point3D(0, 4000, 0), count: 2 };
    arrayCopyDialog.mockResolvedValueOnce(input);

    await harness.controller.arrayCopy();
    expect(arrayCopyDialog).toHaveBeenCalledWith(undefined);
    expect(doc.nodeList).toHaveLength(12);
    expect(doc.memberList).toHaveLength(9);
    expect(harness.notices).toEqual(['8節点、6要素を追加しました']);
    expect(harness.events).toEqual(['cancel', 'track:history.arrayCopy', 'refresh']);

    // 同じ条件でもう一度実行しても、複写先に同じ要素があるため何も増えない。
    arrayCopyDialog.mockResolvedValueOnce(input);
    await harness.controller.arrayCopy();
    expect(arrayCopyDialog).toHaveBeenLastCalledWith(input);
    expect(doc.memberList).toHaveLength(9);
    expect(harness.notices.at(-1)).toBe('複写先に同じ要素が既にあるため、追加はありませんでした');
  });

  it('keeps the model unchanged when the dialog is cancelled or the copy is rejected', async () => {
    const { beam, upper } = buildFrame();
    const harness = createHarness();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    beam.select = true;

    arrayCopyDialog.mockResolvedValueOnce(null);
    await harness.controller.arrayCopy();
    expect(doc.allDataList).toHaveLength(7);
    expect(harness.events).toEqual(['cancel']);

    doc.updateLayer(upper, { locked: true });
    arrayCopyDialog.mockResolvedValueOnce({ offset: new Point3D(0, 4000, 0), count: 1 });
    await harness.controller.arrayCopy();
    expect(alertSpy.mock.calls[0][0]).toMatch(/^複写できませんでした:/);
    expect(doc.allDataList).toHaveLength(7);
  });
});

describe('EditController model cleanup', () => {
  it('merges coincident nodes with the entered tolerance and remembers it', async () => {
    const a = node(0, 0);
    const twin = node(0.5, 0);
    const b = node(1000, 0);
    doc.addMany([a, twin, b, new Beam(a, b), new Beam(twin, b)]);
    const harness = createHarness();

    mergeNodesDialog.mockResolvedValueOnce(null);
    await harness.controller.mergeNodes();
    expect(mergeNodesDialog).toHaveBeenCalledWith(1);
    expect(doc.nodeList).toHaveLength(3);

    mergeNodesDialog.mockResolvedValueOnce(0.1);
    await harness.controller.mergeNodes();
    expect(harness.notices.at(-1)).toBe('結合できる節点はありませんでした');

    mergeNodesDialog.mockResolvedValueOnce(2);
    await harness.controller.mergeNodes();
    expect(mergeNodesDialog).toHaveBeenLastCalledWith(0.1);
    expect(doc.nodeList).toHaveLength(2);
    expect(doc.memberList).toHaveLength(1);
    expect(harness.notices.at(-1)).toBe('1個の節点を結合し、重複した1要素を削除しました');
    expect(harness.events).toContain('track:history.mergeNodes');
  });

  it('removes orphan nodes after confirmation', async () => {
    const a = node(0, 0);
    const b = node(1000, 0);
    const orphan = node(500, 500);
    doc.addMany([a, b, orphan, new Beam(a, b)]);
    const harness = createHarness();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await harness.controller.removeOrphanNodes();
    expect(confirmSpy).toHaveBeenCalledWith('どの要素からも参照されていない節点1個を削除しますか？');
    expect(doc.nodeList).toHaveLength(3);

    confirmSpy.mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('#btn-remove-orphans')!.click();
    await vi.waitFor(() => expect(harness.notices.at(-1)).toBe('孤立節点を1個削除しました'));
    expect(doc.nodeList).toHaveLength(2);

    await harness.controller.removeOrphanNodes();
    expect(harness.notices.at(-1)).toBe('孤立節点はありません');
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});
