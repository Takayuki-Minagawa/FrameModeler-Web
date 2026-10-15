// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/dialogs/LayerDialog', () => ({ showLayerDialog: vi.fn() }));
vi.mock('../src/ui/dialogs/MessageDialog', () => ({
  showMessageDialog: vi.fn(async () => undefined),
  showConfirmDialog: vi.fn(async () => true),
  showChoiceDialog: vi.fn(async () => null),
}));

import { LayerController } from '../src/controllers/LayerController';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { copyLayerContents } from '../src/data/LayerCopy';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import type { CadView } from '../src/ui/CadView';
import { Beam } from '../src/data/Beam';
import { Pillar } from '../src/data/Pillar';
import { showLayerDialog } from '../src/ui/dialogs/LayerDialog';
import { showChoiceDialog, showConfirmDialog, showMessageDialog } from '../src/ui/dialogs/MessageDialog';

const doc = Document.instance;
const showLayerDialogMock = vi.mocked(showLayerDialog);
const choiceDialog = vi.mocked(showChoiceDialog);
const confirmDialog = vi.mocked(showConfirmDialog);
const messageDialog = vi.mocked(showMessageDialog);

function createController(copyContents = vi.fn()): LayerController {
  const controller = new LayerController({
    document: doc,
    cadView: { render: vi.fn(), renderElements: vi.fn() } as unknown as CadView,
    list: document.querySelector<HTMLUListElement>('#layer-list')!,
    coordinateZ: document.querySelector<HTMLInputElement>('#coordinate-z')!,
    cancelOperation: vi.fn(),
    trackChange: async (_label, action) => await action(),
    copyContents,
    root: document,
  });
  controller.connect();
  return controller;
}

function buildTwoStoreys(): { lower: Layer; upper: Layer; pillar: Pillar; upperBeam: Beam } {
  const lower = new Layer(0, '1F', { id: 'layer-lower' });
  const upper = new Layer(3500, '2F', { id: 'layer-upper' });
  doc.addLayer(lower);
  doc.addLayer(upper);
  const a = new Node(new Point3D(0, 0, 0));
  const b = new Node(new Point3D(6000, 0, 0));
  const c = new Node(new Point3D(0, 0, 3500));
  const d = new Node(new Point3D(6000, 0, 3500));
  const pillar = new Pillar(a, c);
  const upperBeam = new Beam(c, d);
  doc.addMany([a, b, c, d, new Beam(a, b), upperBeam, pillar]);
  return { lower, upper, pillar, upperBeam };
}

beforeEach(() => {
  doc.init();
  showLayerDialogMock.mockReset();
  choiceDialog.mockReset();
  confirmDialog.mockReset();
  confirmDialog.mockResolvedValue(true);
  messageDialog.mockReset();
  document.body.innerHTML = `
    <button id="btn-add-layer"></button>
    <button id="btn-remove-layer"></button>
    <button id="btn-duplicate-layer"></button>
    <button id="btn-copy-layer-up"></button>
    <button id="btn-copy-layer-down"></button>
    <button id="btn-show-all-layers"></button>
    <ul id="layer-list"></ul>
    <input id="coordinate-z" />
  `;
});

describe('LayerController mutation boundary', () => {
  it('cancels an active drawing operation immediately before every layer mutation', async () => {
    const lower = new Layer(0, '1F', { id: 'layer-lower' });
    const upper = new Layer(3000, '2F', { id: 'layer-upper' });
    doc.addLayer(lower);
    doc.addLayer(upper);
    doc.shownLayer = lower;
    const events: string[] = [];
    const copyContents = vi.fn();
    const controller = new LayerController({
      document: doc,
      cadView: { render: vi.fn(), renderElements: vi.fn() } as unknown as CadView,
      list: document.querySelector<HTMLUListElement>('#layer-list')!,
      coordinateZ: document.querySelector<HTMLInputElement>('#coordinate-z')!,
      cancelOperation: () => events.push('cancel'),
      trackChange: async (label, action) => {
        events.push(`track:${label}`);
        return await action();
      },
      copyContents,
      root: document,
    });
    controller.connect();

    const expectBoundary = async (label: string, trigger: () => void): Promise<void> => {
      events.length = 0;
      trigger();
      await vi.waitFor(() => expect(events).toContain(`track:${label}`));
      const mutationIndex = events.indexOf(`track:${label}`);
      expect(events[mutationIndex - 1]).toBe('cancel');
    };

    showLayerDialogMock.mockResolvedValueOnce(new Layer(6000, '3F', { id: 'layer-duplicate' }));
    await expectBoundary('history.duplicateLayer', () =>
      document.querySelector<HTMLButtonElement>('#btn-duplicate-layer')!.click(),
    );

    await expectBoundary('history.copyLayerElements', () =>
      document.querySelector<HTMLButtonElement>('#btn-copy-layer-down')!.click(),
    );
    expect(copyContents).toHaveBeenCalled();

    await expectBoundary('history.layerVisibility', () =>
      document.querySelector<HTMLButtonElement>('li[data-layer-id="layer-lower"] [data-action="visibility"]')!.click(),
    );
    await expectBoundary('history.layerLock', () =>
      document.querySelector<HTMLButtonElement>('li[data-layer-id="layer-lower"] [data-action="lock"]')!.click(),
    );
    await expectBoundary('history.isolateLayer', () =>
      document.querySelector<HTMLButtonElement>('li[data-layer-id="layer-upper"] [data-action="isolate"]')!.click(),
    );
    await expectBoundary('history.showAllLayers', () =>
      document.querySelector<HTMLButtonElement>('#btn-show-all-layers')!.click(),
    );
  });

  it('duplicates the source visibility and lock state without copying into a locked target', async () => {
    const source = new Layer(0, '1F', { id: 'layer-source', visible: false });
    doc.addLayer(source);
    doc.shownLayer = source;
    doc.add(new Node(new Point3D(250, 500, 0)));
    doc.updateLayer(source, { locked: true });
    const copyContents = vi.fn((copySource: Layer, target: Layer) => {
      expect(target.locked).toBe(false);
      copyLayerContents(copySource, target, doc);
    });
    const controller = new LayerController({
      document: doc,
      cadView: { render: vi.fn(), renderElements: vi.fn() } as unknown as CadView,
      list: document.querySelector<HTMLUListElement>('#layer-list')!,
      coordinateZ: document.querySelector<HTMLInputElement>('#coordinate-z')!,
      cancelOperation: vi.fn(),
      trackChange: async (_label, action) => await action(),
      copyContents,
      root: document,
    });
    controller.connect();
    showLayerDialogMock.mockImplementationOnce(async (suggestion) => {
      expect(suggestion).toMatchObject({ visible: false, locked: true });
      return new Layer(suggestion!.posZ, suggestion!.name, {
        id: 'layer-duplicate-state',
        visible: suggestion!.visible,
        locked: suggestion!.locked,
      });
    });

    document.querySelector<HTMLButtonElement>('#btn-duplicate-layer')!.click();

    await vi.waitFor(() => expect(copyContents).toHaveBeenCalledOnce());
    expect(doc.shownLayer).toMatchObject({
      id: 'layer-duplicate-state',
      visible: false,
      locked: true,
    });
    expect(doc.nodeList.some((node) => node.pos.x === 250 && node.pos.y === 500 && node.pos.z === 3000)).toBe(true);
  });
});

describe('LayerController deletion, duplication and state exposure', () => {
  it('asks whether to delete the related elements and removes them with the layer', async () => {
    const { upper, pillar, upperBeam } = buildTwoStoreys();
    doc.shownLayer = upper;
    createController();
    choiceDialog.mockResolvedValueOnce('withElements');

    document.querySelector<HTMLButtonElement>('#btn-remove-layer')!.click();
    await vi.waitFor(() => expect(doc.layers).toHaveLength(1));
    expect(choiceDialog.mock.calls[0][0]).toContain('レイヤー「2F」を削除します');
    expect(choiceDialog.mock.calls[0][0]).toContain('4 件');
    expect(doc.allDataList).not.toContain(pillar);
    expect(doc.allDataList).not.toContain(upperBeam);
    expect(doc.nodeList).toHaveLength(2);
    expect(doc.shownLayer?.name).toBe('1F');
  });

  it('keeps the elements when asked, and cancels when the choice dialog is dismissed', async () => {
    const { upper } = buildTwoStoreys();
    doc.shownLayer = upper;
    const controller = createController();
    const before = doc.allDataList.length;

    choiceDialog.mockResolvedValueOnce(null);
    document.querySelector<HTMLButtonElement>('#btn-remove-layer')!.click();
    await vi.waitFor(() => expect(choiceDialog).toHaveBeenCalledTimes(1));
    expect(doc.layers).toHaveLength(2);

    choiceDialog.mockResolvedValueOnce('keepElements');
    document.querySelector<HTMLButtonElement>('#btn-remove-layer')!.click();
    await vi.waitFor(() => expect(doc.layers).toHaveLength(1));
    expect(doc.allDataList).toHaveLength(before);
    void controller;
  });

  it('confirms simply when the layer has no elements and refuses locked related elements', async () => {
    const { lower, upper } = buildTwoStoreys();
    const roof = new Layer(7000, 'RF', { id: 'layer-roof' });
    doc.addLayer(roof);
    doc.shownLayer = roof;
    createController();

    document.querySelector<HTMLButtonElement>('#btn-remove-layer')!.click();
    await vi.waitFor(() => expect(doc.layers).toHaveLength(2));
    expect(confirmDialog).toHaveBeenCalledWith('レイヤー「RF」を削除しますか？', { danger: true });
    expect(choiceDialog).not.toHaveBeenCalled();

    // 2F の要素（柱）は 1F にも属するため、1F をロックすると一緒には削除できない。
    doc.updateLayer(lower, { locked: true });
    doc.shownLayer = upper;
    choiceDialog.mockResolvedValueOnce('withElements');
    document.querySelector<HTMLButtonElement>('#btn-remove-layer')!.click();
    await vi.waitFor(() => expect(messageDialog).toHaveBeenCalled());
    expect(messageDialog.mock.calls[0][0]).toContain('ロック中');
    expect(doc.layers).toHaveLength(2);
  });

  it('suggests a duplicate elevation that does not collide with existing layers', async () => {
    const { lower } = buildTwoStoreys();
    doc.shownLayer = lower;
    createController(vi.fn());
    showLayerDialogMock.mockResolvedValueOnce(null);

    document.querySelector<HTMLButtonElement>('#btn-duplicate-layer')!.click();
    await vi.waitFor(() => expect(showLayerDialogMock).toHaveBeenCalledTimes(1));
    const [suggestion, options] = showLayerDialogMock.mock.calls[0];
    // 1F(0) + 階高 3500 = 3500 は 2F と重複するため、最上階 + 階高 = 7000 を提案する。
    expect(suggestion?.posZ).toBe(7000);
    expect(suggestion?.name).toBe('1F copy');
    expect(options).toMatchObject({ mode: 'add' });
  });

  it('proposes the next storey when adding and creates the layer above on request', async () => {
    const { lower } = buildTwoStoreys();
    doc.shownLayer = lower;
    const controller = createController();

    showLayerDialogMock.mockResolvedValueOnce(null);
    document.querySelector<HTMLButtonElement>('#btn-add-layer')!.click();
    await vi.waitFor(() => expect(showLayerDialogMock).toHaveBeenCalledTimes(1));
    expect(showLayerDialogMock.mock.calls[0][0]).toMatchObject({ name: '3F', posZ: 7000 });

    // 柱・壁の直上が無いときの作成依頼: 現在高さ + 階高 を提案し、作図中の階は変えない。
    showLayerDialogMock.mockImplementationOnce(async (suggestion) => {
      expect(suggestion).toMatchObject({ name: '3F', posZ: 7000 });
      return new Layer(7000, '3F', { id: 'layer-3f' });
    });
    await expect(controller.requestLayerAbove(3500)).resolves.toBe(true);
    expect(doc.layers.map((layer) => layer.name)).toEqual(['1F', '2F', '3F']);
    expect(doc.shownLayer).toBe(lower);

    // 現在高さより低い高さは拒否する。
    showLayerDialogMock.mockResolvedValueOnce(new Layer(1000, 'low'));
    await expect(controller.requestLayerAbove(3500)).resolves.toBe(false);
    expect(messageDialog.mock.calls.at(-1)?.[0]).toContain('3500');
    showLayerDialogMock.mockResolvedValueOnce(null);
    await expect(controller.requestLayerAbove(7000)).resolves.toBe(false);
  });

  it('exposes visibility, lock and isolation state through aria-pressed and shows full names on hover', async () => {
    const { lower, upper } = buildTwoStoreys();
    doc.shownLayer = lower;
    createController();
    const item = (layer: Layer): HTMLLIElement => document.querySelector(`li[data-layer-id="${layer.id}"]`)!;
    const pressed = (layer: Layer, action: string): string | null =>
      item(layer).querySelector(`[data-action="${action}"]`)!.getAttribute('aria-pressed');

    expect(item(lower).querySelector('.layer-label')?.textContent).toBe('1F');
    expect(item(lower).querySelector('.layer-label')?.getAttribute('title')).toBe('1F : 0');
    expect(item(lower).querySelector('.layer-height')?.textContent).toBe('0');
    expect(pressed(lower, 'visibility')).toBe('true');
    expect(pressed(lower, 'lock')).toBe('false');
    expect(pressed(lower, 'isolate')).toBe('false');

    item(upper).querySelector<HTMLButtonElement>('[data-action="isolate"]')!.click();
    await vi.waitFor(() => expect(pressed(upper, 'isolate')).toBe('true'));
    expect(pressed(lower, 'visibility')).toBe('false');
    expect(pressed(lower, 'isolate')).toBe('false');

    item(upper).querySelector<HTMLButtonElement>('[data-action="lock"]')!.click();
    await vi.waitFor(() => expect(pressed(upper, 'lock')).toBe('true'));
  });
});
