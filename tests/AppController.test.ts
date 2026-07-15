import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import type { StoredDraft } from '../src/history/DraftStore';
import { exportDocumentSnapshot } from '../src/io/DocumentSnapshotCodec';
import { Point3D } from '../src/math/Point3D';

const draftStoreMocks = vi.hoisted(() => ({
  clearDraft: vi.fn(),
  clearDraftFamily: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock('../src/history/DraftStore', () => draftStoreMocks);

import { AppController } from '../src/controllers/AppController';

describe('AppController draft recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    draftStoreMocks.clearDraft.mockResolvedValue(undefined);
    draftStoreMocks.clearDraftFamily.mockResolvedValue(undefined);
    draftStoreMocks.saveDraft.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([
    { accepted: true, label: 'accepting' },
    { accepted: false, label: 'declining' },
  ])('clears the recovered tab family after $label a draft', async ({ accepted }) => {
    const document = Document.instance;
    document.init();
    const draft: StoredDraft = {
      ...exportDocumentSnapshot(document),
      savedAt: 100,
      formatVersion: 2,
      draftKey: 'active:crashed-tab:generation:2',
      tabId: 'crashed-tab',
      generation: 2,
    };
    draftStoreMocks.loadDraft.mockResolvedValue(draft);
    const refreshDocument = vi.fn();
    const controller = new AppController({ document, cancelOperation: vi.fn(), refreshDocument });

    await expect(controller.offerDraftRestore(() => accepted)).resolves.toBe(accepted);

    expect(draftStoreMocks.clearDraftFamily).toHaveBeenCalledOnce();
    expect(draftStoreMocks.clearDraftFamily).toHaveBeenCalledWith('crashed-tab');
    expect(draftStoreMocks.clearDraft).not.toHaveBeenCalled();
    expect(refreshDocument).toHaveBeenCalledTimes(accepted ? 1 : 0);
  });

  it('rolls back the complete document and does not record history when a tracked change throws', async () => {
    const document = Document.instance;
    document.init();
    const layer = new Layer(0, '1F', { id: 'rollback-layer' });
    document.addLayer(layer);
    document.shownLayer = layer;
    document.add(new Node(new Point3D(0, 0, 0)));
    document.filename = 'before.json';
    const before = exportDocumentSnapshot(document);
    const cancelOperation = vi.fn();
    const refreshDocument = vi.fn();
    const controller = new AppController({ document, cancelOperation, refreshDocument });

    await expect(
      controller.performTrackedChange('failing change', () => {
        document.add(new Node(new Point3D(1000, 0, 0)));
        document.filename = 'after.json';
        throw new Error('mutation failed');
      }),
    ).rejects.toThrow('mutation failed');

    expect(exportDocumentSnapshot(document)).toEqual(before);
    expect(controller.history.state).toMatchObject({ canUndo: false, canRedo: false, isDirty: false });
    expect(cancelOperation).toHaveBeenCalledOnce();
    expect(refreshDocument).toHaveBeenCalledOnce();
    expect(refreshDocument).toHaveBeenCalledWith(false);
  });
});
