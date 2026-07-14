import type { Document } from '../data/Document';
import { clearDraft, clearDraftFamily, loadDraft, saveDraft } from '../history/DraftStore';
import { DocumentHistory, type DocumentSnapshot, type HistoryState } from '../history/DocumentHistory';
import { exportDocumentSnapshot, importDocumentSnapshot } from '../io/DocumentSnapshotCodec';

export interface AppControllerOptions {
  document: Document;
  cancelOperation: () => void;
  refreshDocument: (fit: boolean) => void;
}

/** 履歴、dirty、draft、snapshot復元というアプリ横断状態を管理する。 */
export class AppController {
  readonly history: DocumentHistory;
  private historyBaseline: DocumentSnapshot;
  private suppressHistory = false;
  private historyFlushScheduled = false;
  private pendingHistoryLabel = 'CAD編集';
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: AppControllerOptions) {
    this.history = new DocumentHistory(
      () => exportDocumentSnapshot(options.document),
      (snapshot) => this.restoreSnapshot(snapshot),
    );
    this.historyBaseline = this.history.capture();
  }

  get isDirty(): boolean {
    return this.history.isDirty;
  }

  capture(): DocumentSnapshot {
    return this.history.capture();
  }

  restoreSnapshot(snapshot: DocumentSnapshot, refresh = true): void {
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    try {
      this.options.cancelOperation();
      importDocumentSnapshot(snapshot, this.options.document);
    } finally {
      this.suppressHistory = previous;
    }
    this.historyBaseline = this.history.capture();
    if (refresh) this.options.refreshDocument(false);
  }

  performTrackedChange = async <T>(label: string, action: () => T | Promise<T>): Promise<T> => {
    const before = this.history.capture();
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    try {
      const result = await action();
      this.history.record(label, before);
      return result;
    } catch (error) {
      this.restoreSnapshot(before);
      throw error;
    } finally {
      this.suppressHistory = previous;
      this.historyBaseline = this.history.capture();
      this.scheduleDraftUpdate();
    }
  };

  withoutHistory<T>(action: () => T): T {
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    try {
      return action();
    } finally {
      this.suppressHistory = previous;
      this.historyBaseline = this.history.capture();
    }
  }

  async withoutHistoryAsync<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.suppressHistory;
    this.suppressHistory = true;
    try {
      return await action();
    } finally {
      this.suppressHistory = previous;
      this.historyBaseline = this.history.capture();
    }
  }

  scheduleHistoryRecord(label: string): void {
    if (this.suppressHistory) {
      this.historyBaseline = this.history.capture();
      return;
    }
    this.pendingHistoryLabel = label;
    if (this.historyFlushScheduled) return;
    this.historyFlushScheduled = true;
    queueMicrotask(() => {
      this.historyFlushScheduled = false;
      this.history.record(this.pendingHistoryLabel, this.historyBaseline);
      this.historyBaseline = this.history.capture();
      this.scheduleDraftUpdate();
    });
  }

  resetHistory(markSaved = true): void {
    this.history.reset(markSaved);
    this.historyBaseline = this.history.capture();
  }

  markSaved(): void {
    this.history.markSaved();
    this.historyBaseline = this.history.capture();
    void clearDraft();
  }

  undo(): boolean {
    const changed = this.history.undo();
    if (changed) {
      this.historyBaseline = this.history.capture();
      this.scheduleDraftUpdate();
    }
    return changed;
  }

  redo(): boolean {
    const changed = this.history.redo();
    if (changed) {
      this.historyBaseline = this.history.capture();
      this.scheduleDraftUpdate();
    }
    return changed;
  }

  subscribeHistory(listener: (state: HistoryState) => void): () => void {
    return this.history.subscribe(listener);
  }

  scheduleDraftUpdate(): void {
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      if (this.history.isDirty) void saveDraft(this.history.capture());
      else void clearDraft();
    }, 750);
  }

  async offerDraftRestore(confirmRestore: (savedAt: number) => boolean): Promise<boolean> {
    const draft = await loadDraft();
    if (!draft) return false;
    if (confirmRestore(draft.savedAt)) {
      this.restoreSnapshot(draft, false);
      this.history.reset(false);
      this.historyBaseline = this.history.capture();
      this.options.refreshDocument(true);
      await clearDraftFamily(draft.tabId);
      this.scheduleDraftUpdate();
      return true;
    }
    await clearDraftFamily(draft.tabId);
    return false;
  }
}

export function sameSnapshot(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
  return (
    a.json === b.json && a.filename === b.filename && JSON.stringify(a.shownLayer) === JSON.stringify(b.shownLayer)
  );
}
