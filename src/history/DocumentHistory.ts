import type { PortableDocumentSnapshot } from '../io/DocumentSnapshotCodec';

export type DocumentSnapshot = PortableDocumentSnapshot;

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

interface HistoryEntry {
  label: string;
  before: DocumentSnapshot;
  after: DocumentSnapshot;
}

type CaptureSnapshot = () => DocumentSnapshot;
type RestoreSnapshot = (snapshot: DocumentSnapshot) => void;
type HistoryListener = (state: HistoryState) => void;

/**
 * Document の変更履歴を、保存可能なスナップショット単位で管理する。
 *
 * 既存の Document シングルトンは維持し、UI 操作の開始前/確定後をこのクラスへ
 * 渡すことで、追加・編集・削除・import を同じ Undo/Redo 契約に載せる。
 */
export class DocumentHistory {
  private entries: HistoryEntry[] = [];
  private cursor = 0;
  private savedFingerprint: string;
  private readonly listeners = new Set<HistoryListener>();

  constructor(
    private readonly captureSnapshot: CaptureSnapshot,
    private readonly restoreSnapshot: RestoreSnapshot,
    private readonly maxEntries: number = 100,
  ) {
    this.savedFingerprint = fingerprint(this.captureSnapshot());
  }

  capture(): DocumentSnapshot {
    return this.captureSnapshot();
  }

  /** 変更前スナップショットと現在状態を比較し、有効な変更だけ履歴へ追加する。 */
  record(label: string, before: DocumentSnapshot): boolean {
    const after = this.captureSnapshot();
    if (fingerprint(before) === fingerprint(after)) return false;

    this.entries.splice(this.cursor);
    this.entries.push({ label, before, after });
    this.cursor = this.entries.length;

    if (this.entries.length > this.maxEntries) {
      const overflow = this.entries.length - this.maxEntries;
      this.entries.splice(0, overflow);
      this.cursor -= overflow;
    }

    this.notify();
    return true;
  }

  /** 同期/非同期処理を1履歴として実行する。例外時は履歴へ追加しない。 */
  async perform<T>(label: string, action: () => T | Promise<T>): Promise<T> {
    const before = this.captureSnapshot();
    const result = await action();
    this.record(label, before);
    return result;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const entry = this.entries[this.cursor - 1];
    this.restoreSnapshot(entry.before);
    this.cursor--;
    this.notify();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const entry = this.entries[this.cursor];
    this.restoreSnapshot(entry.after);
    this.cursor++;
    this.notify();
    return true;
  }

  /** 新規作成/読込後に履歴を捨て、現在状態を保存済み基準にする。 */
  reset(markSaved: boolean = true): void {
    this.entries = [];
    this.cursor = 0;
    if (markSaved) this.savedFingerprint = fingerprint(this.captureSnapshot());
    this.notify();
  }

  markSaved(): void {
    this.savedFingerprint = fingerprint(this.captureSnapshot());
    this.notify();
  }

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  get isDirty(): boolean {
    return fingerprint(this.captureSnapshot()) !== this.savedFingerprint;
  }

  get state(): HistoryState {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      isDirty: this.isDirty,
      undoLabel: this.canUndo ? this.entries[this.cursor - 1].label : undefined,
      redoLabel: this.canRedo ? this.entries[this.cursor].label : undefined,
    };
  }

  private notify(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}

/** 選択状態は編集内容ではないため dirty/履歴差分から除外する。 */
function fingerprint(snapshot: DocumentSnapshot): string {
  try {
    const parsed = JSON.parse(snapshot.json) as unknown;
    stripTransientState(parsed);
    return JSON.stringify(parsed);
  } catch {
    // capture 実装が一時的に不正な文字列を返しても比較自体は決定的にする。
    return snapshot.json;
  }
}

function stripTransientState(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(stripTransientState);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  delete record.select;
  for (const child of Object.values(record)) stripTransientState(child);
}
