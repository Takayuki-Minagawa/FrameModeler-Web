// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/dialogs/LayerDialog', () => ({ showLayerDialog: vi.fn() }));

import { LayerController } from '../src/controllers/LayerController';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
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
    await expectBoundary('レイヤー複製', () =>
      document.querySelector<HTMLButtonElement>('#btn-duplicate-layer')!.click(),
    );

    await expectBoundary('レイヤー要素コピー', () =>
      document.querySelector<HTMLButtonElement>('#btn-copy-layer-down')!.click(),
    );
    expect(copyContents).toHaveBeenCalled();

    await expectBoundary('レイヤー表示変更', () =>
      document.querySelector<HTMLButtonElement>('li[data-layer-id="layer-lower"] [data-action="visibility"]')!.click(),
    );
    await expectBoundary('レイヤーロック変更', () =>
      document.querySelector<HTMLButtonElement>('li[data-layer-id="layer-lower"] [data-action="lock"]')!.click(),
    );
    await expectBoundary('レイヤー隔離', () =>
      document.querySelector<HTMLButtonElement>('li[data-layer-id="layer-upper"] [data-action="isolate"]')!.click(),
    );
    await expectBoundary('全レイヤー表示', () =>
      document.querySelector<HTMLButtonElement>('#btn-show-all-layers')!.click(),
    );
  });
});
