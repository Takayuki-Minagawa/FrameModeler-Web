import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../src/data/Document';
import type { StoredDraft } from '../src/history/DraftStore';
import { exportDocumentSnapshot } from '../src/io/DocumentSnapshotCodec';

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
});
