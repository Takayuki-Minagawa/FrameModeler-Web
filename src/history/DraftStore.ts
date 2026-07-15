import type { DocumentSnapshot } from './DocumentHistory';
import { createJsonImportPlan } from '../io/JsonDeserializer';
import { parseJsonDocument } from '../io/JsonSchema';

export interface StoredDraft extends DocumentSnapshot {
  savedAt: number;
  formatVersion: 1 | 2;
  draftKey: string;
  tabId: string;
  generation: number;
}

export interface DraftStorageEntry {
  key: string;
  value: unknown;
}

/** IndexedDB以外の軽量実装でも世代管理を検証できる最小storage契約。 */
export interface DraftStorage {
  list(): Promise<DraftStorageEntry[]>;
  put(key: string, value: unknown): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export interface DraftStoreContext {
  tabId: string;
  maxGenerations?: number;
  maxFamilies?: number;
  familyTtlMs?: number;
  now?: () => number;
}

export interface DraftIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DraftRuntimeIdentity {
  /** このページロードだけが書き込む一意なID。 */
  tabId: string;
  /** reload/タブ複製元がsessionStorageに残したID。復旧候補の追跡にのみ使う。 */
  inheritedTabId: string | null;
}

const DB_NAME = 'framemodeler-web';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const DRAFT_KEY_PREFIX = 'active:';
const GENERATION_SEPARATOR = ':generation:';
const TAB_ID_KEY = 'framemodeler-draft-tab-id';
export const MAX_DRAFT_GENERATIONS = 3;
export const MAX_DRAFT_FAMILIES = 20;
export const DRAFT_FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

let mutationQueue: Promise<void> = Promise.resolve();
let runtimeIdentity: DraftRuntimeIdentity | null = null;

/** IndexedDB が利用できない環境では静かに無効化する。 */
export function saveDraft(snapshot: DocumentSnapshot): Promise<boolean> {
  return enqueueMutation(async () => {
    await withIndexedDb((storage) => saveDraftToStorage(storage, snapshot, { tabId: currentTabId() }));
    return true;
  }).catch(() => false);
}

/**
 * 現在タブだけでなく、異常終了した旧sessionを含む全active draftから
 * 最新の復元可能な世代を返す。破損recordと保持上限外の世代はbest-effortで除去する。
 */
export function loadDraft(): Promise<StoredDraft | null> {
  return enqueueMutation(() =>
    withIndexedDb((storage) => loadDraftFromStorage(storage, { tabId: currentTabId() })),
  ).catch(() => null);
}

/**
 * draftKey指定時はその世代だけ、未指定時は現在タブの全世代を削除する。
 * 従来のactive:<tab> recordも同じ契約で扱う。
 */
export function clearDraft(draftKey?: string): Promise<void> {
  return enqueueMutation(() =>
    withIndexedDb((storage) => clearDraftFromStorage(storage, { tabId: currentTabId() }, draftKey)),
  ).catch(() => {
    // private browsing / quota / IndexedDB無効時もアプリ操作は継続する。
  });
}

/** 復旧を処理済みにした旧tabの全世代を削除する。 */
export function clearDraftFamily(tabId: string): Promise<void> {
  return enqueueMutation(() => withIndexedDb((storage) => clearDraftFamilyFromStorage(storage, tabId))).catch(() => {
    // cleanup失敗は通常のアプリ操作を妨げない。
  });
}

/** storage非依存の保存処理。タブ内で単調増加する世代を付与し、上限を維持する。 */
export async function saveDraftToStorage(
  storage: DraftStorage,
  snapshot: DocumentSnapshot,
  context: DraftStoreContext,
): Promise<StoredDraft> {
  assertTabId(context.tabId);
  assertRestorableSnapshot(snapshot);
  const requestedTime = readTimestamp(context.now);
  const inspectionPolicy = readInspectionPolicy(context, requestedTime);

  const entries = await storage.list();
  const inspection = inspectEntries(entries, inspectionPolicy);
  const currentDrafts = inspection.retained.filter((draft) => draft.tabId === context.tabId);
  const maxGeneration = currentDrafts.reduce((maximum, draft) => Math.max(maximum, draft.generation), 0);
  if (maxGeneration >= Number.MAX_SAFE_INTEGER) throw new Error('Draft generation limit exceeded');

  const previousSavedAt = currentDrafts.reduce((maximum, draft) => Math.max(maximum, draft.savedAt), -1);
  const generation = maxGeneration + 1;
  const savedAt = Math.max(requestedTime, previousSavedAt + 1);
  const draftKey = generationDraftKey(context.tabId, generation);
  const draft: StoredDraft = {
    ...snapshot,
    savedAt,
    formatVersion: 2,
    draftKey,
    tabId: context.tabId,
    generation,
  };

  await storage.put(draftKey, draft);

  const nextEntries = entries.filter((entry) => entry.key !== draftKey);
  nextEntries.push({ key: draftKey, value: draft });
  const nextInspection = inspectEntries(nextEntries, inspectionPolicy);
  await bestEffortRemove(storage, nextInspection.purgeKeys);
  return draft;
}

/** storage非依存の探索処理。全タブを走査するため、新sessionからも旧draftを発見できる。 */
export async function loadDraftFromStorage(
  storage: DraftStorage,
  context: DraftStoreContext,
): Promise<StoredDraft | null> {
  assertTabId(context.tabId);
  const inspection = inspectEntries(await storage.list(), readInspectionPolicy(context, readTimestamp(context.now)));
  await bestEffortRemove(storage, inspection.purgeKeys);

  const latestByTab = new Map<string, StoredDraft>();
  for (const draft of inspection.retained) {
    const latest = latestByTab.get(draft.tabId);
    if (!latest || compareDraftRecency(draft, latest) < 0) latestByTab.set(draft.tabId, draft);
  }

  return (
    [...latestByTab.values()].sort((left, right) => compareRecoveryCandidates(left, right, context.tabId))[0] ?? null
  );
}

/** storage非依存の削除処理。明示keyは1世代、未指定は現在タブを対象にする。 */
export async function clearDraftFromStorage(
  storage: DraftStorage,
  context: Pick<DraftStoreContext, 'tabId'>,
  draftKey?: string,
): Promise<void> {
  assertTabId(context.tabId);
  if (draftKey !== undefined) {
    await storage.remove([draftKey]);
    return;
  }

  await clearDraftFamilyFromStorage(storage, context.tabId);
}

/** 指定tab familyのlegacy recordと全世代をまとめて削除する。 */
export async function clearDraftFamilyFromStorage(storage: DraftStorage, tabId: string): Promise<void> {
  assertTabId(tabId);
  const keys = (await storage.list()).map((entry) => entry.key).filter((key) => belongsToTab(key, tabId));
  await storage.remove(keys);
}

interface DraftKeyInfo {
  tabId: string;
  generation: number | null;
}

interface DraftInspection {
  retained: StoredDraft[];
  purgeKeys: string[];
}

interface DraftInspectionPolicy {
  currentTabId: string;
  maxGenerations: number;
  maxFamilies: number;
  familyTtlMs: number;
  now: number;
}

function inspectEntries(entries: readonly DraftStorageEntry[], policy: DraftInspectionPolicy): DraftInspection {
  const draftsByTab = new Map<string, StoredDraft[]>();
  const purgeKeys = new Set<string>();

  for (const entry of entries) {
    if (!entry.key.startsWith(DRAFT_KEY_PREFIX)) continue;
    const draft = normalizeStoredDraft(entry);
    if (!draft) {
      purgeKeys.add(entry.key);
      continue;
    }
    const drafts = draftsByTab.get(draft.tabId) ?? [];
    drafts.push(draft);
    draftsByTab.set(draft.tabId, drafts);
  }

  const retainedByTab = new Map<string, StoredDraft[]>();
  for (const [tabId, drafts] of draftsByTab) {
    drafts.sort(compareGenerations);
    retainedByTab.set(tabId, drafts.slice(0, policy.maxGenerations));
    for (const stale of drafts.slice(policy.maxGenerations)) purgeKeys.add(stale.draftKey);
  }

  const latestByTab = [...retainedByTab.entries()]
    .map(([tabId, drafts]) => ({ tabId, draft: [...drafts].sort(compareDraftRecency)[0] }))
    .filter((candidate): candidate is { tabId: string; draft: StoredDraft } => candidate.draft !== undefined)
    .sort((left, right) => compareDraftRecency(left.draft, right.draft));

  // TTLを超えたfamilyも、全体最新の有効draftだけは必ず残して復旧経路を失わない。
  const protectedTabs = new Set<string>();
  if (latestByTab[0]) protectedTabs.add(latestByTab[0].tabId);
  if (retainedByTab.has(policy.currentTabId)) protectedTabs.add(policy.currentTabId);

  const cutoff = policy.now - policy.familyTtlMs;
  const eligibleTabs = latestByTab.filter(({ tabId, draft }) => protectedTabs.has(tabId) || draft.savedAt >= cutoff);
  const retainedTabs = new Set(protectedTabs);
  for (const { tabId } of eligibleTabs) {
    if (retainedTabs.has(tabId)) continue;
    if (retainedTabs.size >= policy.maxFamilies) break;
    retainedTabs.add(tabId);
  }

  const retained: StoredDraft[] = [];
  for (const [tabId, drafts] of retainedByTab) {
    if (retainedTabs.has(tabId)) retained.push(...drafts);
    else for (const draft of drafts) purgeKeys.add(draft.draftKey);
  }
  return { retained, purgeKeys: [...purgeKeys] };
}

function normalizeStoredDraft(entry: DraftStorageEntry): StoredDraft | null {
  if (!entry.value || typeof entry.value !== 'object') return null;
  const value = entry.value as Partial<StoredDraft>;
  const key = parseDraftKey(entry.key);
  if (
    !key ||
    value.draftKey !== entry.key ||
    typeof value.json !== 'string' ||
    typeof value.filename !== 'string' ||
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt) ||
    value.savedAt < 0
  ) {
    return null;
  }

  let tabId: string;
  let generation: number;
  if (value.formatVersion === 2) {
    if (
      key.generation === null ||
      typeof value.tabId !== 'string' ||
      value.tabId !== key.tabId ||
      !Number.isSafeInteger(value.generation) ||
      value.generation !== key.generation
    ) {
      return null;
    }
    tabId = value.tabId;
    generation = value.generation;
  } else if (value.formatVersion === 1) {
    if (key.generation !== null) return null;
    tabId = key.tabId;
    generation = 0;
  } else {
    return null;
  }

  const snapshot: DocumentSnapshot = {
    json: value.json,
    filename: value.filename,
    shownLayer: value.shownLayer,
  };
  try {
    assertRestorableSnapshot(snapshot);
  } catch {
    return null;
  }

  return {
    ...snapshot,
    savedAt: value.savedAt,
    formatVersion: value.formatVersion,
    draftKey: entry.key,
    tabId,
    generation,
  };
}

function assertRestorableSnapshot(snapshot: DocumentSnapshot): void {
  if (typeof snapshot.json !== 'string' || typeof snapshot.filename !== 'string') {
    throw new Error('Invalid draft snapshot');
  }
  // schemaだけでなく参照解決・ModelValidator・metadataまで、Documentを変更せず検証する。
  createJsonImportPlan(snapshot.json);
  const parsed = parseJsonDocument(snapshot.json);
  if (snapshot.shownLayer === undefined || snapshot.shownLayer === null) return;

  const { id, posZ, name } = snapshot.shownLayer;
  if (
    (id !== undefined && (typeof id !== 'string' || id.length === 0)) ||
    typeof posZ !== 'number' ||
    !Number.isFinite(posZ) ||
    typeof name !== 'string'
  ) {
    throw new Error('Invalid draft shownLayer');
  }
  const exists = parsed.layers.some((layer) =>
    id === undefined ? layer.posZ === posZ && layer.name === name : layer.id === id,
  );
  if (!exists) throw new Error('Draft shownLayer does not exist');
}

function compareGenerations(left: StoredDraft, right: StoredDraft): number {
  if (left.generation !== right.generation) return right.generation - left.generation;
  if (left.savedAt !== right.savedAt) return right.savedAt - left.savedAt;
  return right.draftKey.localeCompare(left.draftKey);
}

function compareDraftRecency(left: StoredDraft, right: StoredDraft): number {
  if (left.savedAt !== right.savedAt) return right.savedAt - left.savedAt;
  if (left.generation !== right.generation) return right.generation - left.generation;
  return right.draftKey.localeCompare(left.draftKey);
}

function compareRecoveryCandidates(left: StoredDraft, right: StoredDraft, currentTab: string): number {
  if (left.savedAt !== right.savedAt) return right.savedAt - left.savedAt;
  const leftIsCurrent = left.tabId === currentTab;
  const rightIsCurrent = right.tabId === currentTab;
  if (leftIsCurrent !== rightIsCurrent) return leftIsCurrent ? -1 : 1;
  return compareGenerations(left, right);
}

function parseDraftKey(key: string): DraftKeyInfo | null {
  if (!key.startsWith(DRAFT_KEY_PREFIX)) return null;
  const body = key.slice(DRAFT_KEY_PREFIX.length);
  if (!body) return null;
  const separatorIndex = body.lastIndexOf(GENERATION_SEPARATOR);
  if (separatorIndex < 0) return { tabId: body, generation: null };

  const tabId = body.slice(0, separatorIndex);
  const generationText = body.slice(separatorIndex + GENERATION_SEPARATOR.length);
  const generation = Number(generationText);
  if (!tabId || !Number.isSafeInteger(generation) || generation < 1 || String(generation) !== generationText) {
    return null;
  }
  return { tabId, generation };
}

function generationDraftKey(tabId: string, generation: number): string {
  return `${DRAFT_KEY_PREFIX}${tabId}${GENERATION_SEPARATOR}${generation}`;
}

function belongsToTab(key: string, tabId: string): boolean {
  const baseKey = DRAFT_KEY_PREFIX + tabId;
  return key === baseKey || key.startsWith(baseKey + GENERATION_SEPARATOR);
}

function assertTabId(tabId: string): void {
  if (!tabId || tabId.includes(GENERATION_SEPARATOR)) throw new Error('Invalid draft tab id');
}

function readMaxGenerations(value: number | undefined): number {
  const result = value ?? MAX_DRAFT_GENERATIONS;
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Invalid draft generation limit');
  return result;
}

function readMaxFamilies(value: number | undefined): number {
  const result = value ?? MAX_DRAFT_FAMILIES;
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Invalid draft family limit');
  return result;
}

function readFamilyTtlMs(value: number | undefined): number {
  const result = value ?? DRAFT_FAMILY_TTL_MS;
  if (!Number.isFinite(result) || result < 0) throw new Error('Invalid draft family TTL');
  return result;
}

function readTimestamp(now: (() => number) | undefined): number {
  const result = (now ?? Date.now)();
  if (!Number.isFinite(result) || result < 0) throw new Error('Invalid draft timestamp');
  return result;
}

function readInspectionPolicy(context: DraftStoreContext, now: number): DraftInspectionPolicy {
  return {
    currentTabId: context.tabId,
    maxGenerations: readMaxGenerations(context.maxGenerations),
    maxFamilies: readMaxFamilies(context.maxFamilies),
    familyTtlMs: readFamilyTtlMs(context.familyTtlMs),
    now,
  };
}

async function bestEffortRemove(storage: DraftStorage, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await storage.remove([...new Set(keys)]);
  } catch {
    // cleanup失敗で復旧可能なsnapshotまで見失わない。
  }
}

/**
 * sessionStorageは「タブを複製」で値まで複製されるため、保存済みIDをwriter IDとして再利用しない。
 * ページロードごとに新IDへローテーションし、旧IDのdraftは全family走査で復旧する。
 */
export function createDraftRuntimeIdentity(
  storage: DraftIdentityStorage | null | undefined,
  idFactory: () => string = createId,
): DraftRuntimeIdentity {
  let inheritedTabId: string | null = null;
  try {
    inheritedTabId = storage?.getItem(TAB_ID_KEY) ?? null;
  } catch {
    // sessionStorageを読めなくてもmemory上のwriter IDで保存を継続する。
  }

  let tabId = idFactory();
  if (tabId === inheritedTabId) tabId = idFactory();
  assertTabId(tabId);
  if (tabId === inheritedTabId) throw new Error('Draft writer id was not rotated');

  try {
    storage?.setItem(TAB_ID_KEY, tabId);
  } catch {
    // private browsing等で書き込めなくても、このページ内ではmodule cacheがIDを保持する。
  }
  return { tabId, inheritedTabId };
}

function currentTabId(): string {
  if (runtimeIdentity) return runtimeIdentity.tabId;
  let storage: DraftIdentityStorage | null = null;
  try {
    if (typeof sessionStorage !== 'undefined') storage = sessionStorage;
  } catch {
    // global自体にアクセスできない環境ではmemory identityへfallbackする。
  }
  runtimeIdentity = createDraftRuntimeIdentity(storage);
  return runtimeIdentity.tabId;
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** save/load/clearを呼出順に直列化し、putとpurgeの競合を防ぐ。 */
function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function withIndexedDb<T>(operation: (storage: DraftStorage) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await operation(new IndexedDbDraftStorage(db));
  } finally {
    db.close();
  }
}

class IndexedDbDraftStorage implements DraftStorage {
  constructor(private readonly db: IDBDatabase) {}

  list(): Promise<DraftStorageEntry[]> {
    return new Promise((resolve, reject) => {
      const entries: DraftStorageEntry[] = [];
      const request = this.db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        if (typeof cursor.key === 'string') entries.push({ key: cursor.key, value: cursor.value });
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to list IndexedDB drafts'));
    });
  }

  async put(key: string, value: unknown): Promise<void> {
    const transaction = this.db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, key);
    await transactionToPromise(transaction);
  }

  async remove(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const transaction = this.db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    await transactionToPromise(transaction);
  }
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

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}
