// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/dialogs/LayerDialog', () => ({ showLayerDialog: vi.fn() }));

import { LayerController } from '../src/controllers/LayerController';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { copyLayerContents } from '../src/data/LayerCopy';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import type { CadView } from '../src/ui/CadView';
import { showLayerDialog } from '../src/ui/dialogs/LayerDialog';

const doc = Document.instance;
const showLayerDialogMock = vi.mocked(showLayerDialog);

beforeEach(() => {
  doc.init();
  showLayerDialogMock.mockReset();
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
