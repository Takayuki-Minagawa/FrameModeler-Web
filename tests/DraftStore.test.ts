import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from '../src/history/DocumentHistory';
import {
  clearDraftFromStorage,
  clearDraftFamilyFromStorage,
  loadDraftFromStorage,
  saveDraftToStorage,
  type DraftStorage,
  type DraftStorageEntry,
  type StoredDraft,
} from '../src/history/DraftStore';

class MemoryDraftStorage implements DraftStorage {
  readonly records = new Map<string, unknown>();

  async list(): Promise<DraftStorageEntry[]> {
    return [...this.records].map(([key, value]) => ({ key, value: structuredClone(value) }));
  }

  async put(key: string, value: unknown): Promise<void> {
    this.records.set(key, structuredClone(value));
  }

  async remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.records.delete(key);
  }
}

function snapshot(name: string): DocumentSnapshot {
  return {
    json: JSON.stringify({
      schemaVersion: 2,
      nodes: [],
      beams: [],
      pillars: [],
      trusses: [],
      springs: [],
      floors: [],
      walls: [],
      bearWalls: [],
      supports: [],
      constraints: [],
      layers: [],
    }),
    filename: `${name}.json`,
    shownLayer: null,
  };
}

function storedDrafts(storage: MemoryDraftStorage): StoredDraft[] {
  return [...storage.records.values()].filter(
    (value): value is StoredDraft =>
      !!value && typeof value === 'object' && 'formatVersion' in value && 'generation' in value,
  );
}

describe('DraftStore generation management', () => {
  it('keeps at most three monotonically numbered generations per tab', async () => {
    const storage = new MemoryDraftStorage();

    for (let generation = 1; generation <= 4; generation++) {
      await saveDraftToStorage(storage, snapshot(`draft-${generation}`), {
        tabId: 'tab-a',
        now: () => generation * 100,
      });
    }

    const drafts = storedDrafts(storage).sort((left, right) => left.generation - right.generation);
    expect(drafts.map((draft) => draft.generation)).toEqual([2, 3, 4]);
    expect(drafts.map((draft) => draft.savedAt)).toEqual([200, 300, 400]);
    expect([...storage.records.keys()]).not.toContain('active:tab-a:generation:1');
  });

  it('finds the newest active draft after a new browser session receives a different tab id', async () => {
    const storage = new MemoryDraftStorage();
    await saveDraftToStorage(storage, snapshot('old-session'), { tabId: 'old-tab', now: () => 100 });
    await saveDraftToStorage(storage, snapshot('other-session'), { tabId: 'other-tab', now: () => 200 });

    const restored = await loadDraftFromStorage(storage, { tabId: 'new-tab' });

    expect(restored?.filename).toBe('other-session.json');
    expect(restored?.tabId).toBe('other-tab');
  });

  it('purges a corrupt newest generation and falls back to the previous valid snapshot', async () => {
    const storage = new MemoryDraftStorage();
    const first = await saveDraftToStorage(storage, snapshot('valid'), { tabId: 'crashed-tab', now: () => 100 });
    const second = await saveDraftToStorage(storage, snapshot('corrupt'), {
      tabId: 'crashed-tab',
      now: () => 200,
    });
    storage.records.set(second.draftKey, { ...second, json: '{broken' });

    const restored = await loadDraftFromStorage(storage, { tabId: 'new-tab' });

    expect(restored?.draftKey).toBe(first.draftKey);
    expect(restored?.filename).toBe('valid.json');
    expect(storage.records.has(second.draftKey)).toBe(false);
  });

  it('purges stale generations from every active tab while retaining each tab limit', async () => {
    const storage = new MemoryDraftStorage();
    for (const tabId of ['tab-a', 'tab-b']) {
      for (let generation = 1; generation <= 4; generation++) {
        const key = `active:${tabId}:generation:${generation}`;
        storage.records.set(key, {
          ...snapshot(`${tabId}-${generation}`),
          savedAt: generation * 100,
          formatVersion: 2,
          draftKey: key,
          tabId,
          generation,
        } satisfies StoredDraft);
      }
    }

    await loadDraftFromStorage(storage, { tabId: 'new-tab' });

    expect(storedDrafts(storage).filter((draft) => draft.tabId === 'tab-a')).toHaveLength(3);
    expect(storedDrafts(storage).filter((draft) => draft.tabId === 'tab-b')).toHaveLength(3);
    expect(storage.records.has('active:tab-a:generation:1')).toBe(false);
    expect(storage.records.has('active:tab-b:generation:1')).toBe(false);
  });

  it('loads a legacy per-tab record and normalizes its generation for migration compatibility', async () => {
    const storage = new MemoryDraftStorage();
    const draftKey = 'active:legacy-tab';
    storage.records.set(draftKey, {
      ...snapshot('legacy'),
      savedAt: 150,
      formatVersion: 1,
      draftKey,
    });

    const restored = await loadDraftFromStorage(storage, { tabId: 'new-tab' });

    expect(restored).toMatchObject({ draftKey, tabId: 'legacy-tab', generation: 0, formatVersion: 1 });
  });

  it('clears one specified generation or every generation of the current tab', async () => {
    const storage = new MemoryDraftStorage();
    const first = await saveDraftToStorage(storage, snapshot('first'), { tabId: 'tab-a', now: () => 100 });
    const second = await saveDraftToStorage(storage, snapshot('second'), { tabId: 'tab-a', now: () => 200 });
    const other = await saveDraftToStorage(storage, snapshot('other'), { tabId: 'tab-b', now: () => 300 });

    await clearDraftFromStorage(storage, { tabId: 'tab-a' }, second.draftKey);
    expect(storage.records.has(first.draftKey)).toBe(true);
    expect(storage.records.has(second.draftKey)).toBe(false);

    await clearDraftFromStorage(storage, { tabId: 'tab-a' });
    expect(storage.records.has(first.draftKey)).toBe(false);
    expect(storage.records.has(other.draftKey)).toBe(true);

    await clearDraftFamilyFromStorage(storage, 'tab-b');
    expect(storage.records.has(other.draftKey)).toBe(false);
  });
});
