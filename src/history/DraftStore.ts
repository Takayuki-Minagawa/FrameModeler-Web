import type { DocumentSnapshot } from './DocumentHistory';

export interface StoredDraft extends DocumentSnapshot {
  savedAt: number;
  formatVersion: 1;
  draftKey: string;
}

const DB_NAME = 'framemodeler-web';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const DRAFT_KEY_PREFIX = 'active:';
const TAB_ID_KEY = 'framemodeler-draft-tab-id';
let mutationQueue: Promise<void> = Promise.resolve();
let fallbackTabId = '';

/** IndexedDB が利用できない環境では静かに無効化する。 */
export function saveDraft(snapshot: DocumentSnapshot): Promise<boolean> {
  return enqueueMutation(async () => {
    const db = await openDatabase();
    const draftKey = currentDraftKey();
    const draft: StoredDraft = {
      ...snapshot,
      savedAt: Date.now(),
      formatVersion: 1,
      draftKey,
    };
    await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(draft, draftKey));
    db.close();
    return true;
  }).catch(() => false);
}

export async function loadDraft(): Promise<StoredDraft | null> {
  try {
    await mutationQueue;
    const db = await openDatabase();
    const value = await requestToPromise<unknown>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(currentDraftKey()),
    );
    db.close();
    return isStoredDraft(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearDraft(draftKey: string = currentDraftKey()): Promise<void> {
  return enqueueMutation(async () => {
    const db = await openDatabase();
    await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(draftKey));
    db.close();
  }).catch(() => {
    // private browsing / quota / IndexedDB無効時もアプリ操作は継続する。
  });
}

function currentDraftKey(): string {
  let tabId: string;
  try {
    tabId = sessionStorage.getItem(TAB_ID_KEY) ?? '';
    if (!tabId) {
      tabId = createId();
      sessionStorage.setItem(TAB_ID_KEY, tabId);
    }
  } catch {
    fallbackTabId ||= createId();
    tabId = fallbackTabId;
  }
  return DRAFT_KEY_PREFIX + tabId;
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<StoredDraft>;
  return (
    draft.formatVersion === 1 &&
    typeof draft.draftKey === 'string' &&
    draft.draftKey.startsWith(DRAFT_KEY_PREFIX) &&
    typeof draft.json === 'string' &&
    typeof draft.filename === 'string' &&
    typeof draft.savedAt === 'number' &&
    Number.isFinite(draft.savedAt)
  );
}

/** save/clearを呼出順に直列化し、遅いputが後続clearを追い越す競合を防ぐ。 */
function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function requestToPromise<T = IDBValidKey>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
