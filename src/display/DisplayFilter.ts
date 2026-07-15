import type { DocumentData } from '../data/DocumentData';

export type DisplayMode = 'all' | 'selectedOnly' | 'isolate';

/** DOMに依存しない表示状態のスナップショット。要素はオブジェクト同一性で管理する。 */
export interface DisplaySettings {
  readonly mode: DisplayMode;
  readonly hidden: ReadonlyArray<DocumentData>;
  readonly isolated: ReadonlyArray<DocumentData>;
}

export type DisplayFilterListener = (settings: Readonly<DisplaySettings>) => void;

/**
 * 選択要素のみ表示、一時非表示、隔離表示を一元管理する。
 * DocumentやCadViewを参照しないため、描画以外の一覧・検証画面でも再利用できる。
 */
export class DisplayFilter {
  private modeValue: DisplayMode = 'all';
  private readonly hidden = new Set<DocumentData>();
  private readonly isolated = new Set<DocumentData>();
  private readonly listeners = new Set<DisplayFilterListener>();

  get mode(): DisplayMode {
    return this.modeValue;
  }

  get settings(): Readonly<DisplaySettings> {
    return Object.freeze({
      mode: this.modeValue,
      hidden: Object.freeze([...this.hidden]),
      isolated: Object.freeze([...this.isolated]),
    });
  }

  subscribe(listener: DisplayFilterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 選択状態に追従して、選択中の要素だけを表示する。 */
  showSelectedOnly(enabled = true): void {
    const next: DisplayMode = enabled ? 'selectedOnly' : 'all';
    if (this.modeValue === next) return;
    this.modeValue = next;
    if (!enabled) this.isolated.clear();
    this.notify();
  }

  /** 指定要素を表示対象から除外する。既存の表示モードとは独立して適用される。 */
  hide(data: DocumentData | Iterable<DocumentData>): void {
    const previousSize = this.hidden.size;
    for (const item of toIterable(data)) this.hidden.add(item);
    if (this.hidden.size !== previousSize) this.notify();
  }

  /** 候補のうち現在選択中の要素を非表示にし、追加件数を返す。 */
  hideSelected(candidates: Iterable<DocumentData>): number {
    const previousSize = this.hidden.size;
    for (const data of candidates) {
      if (data.select) this.hidden.add(data);
    }
    const added = this.hidden.size - previousSize;
    if (added > 0) this.notify();
    return added;
  }

  show(data: DocumentData | Iterable<DocumentData>): void {
    let changed = false;
    for (const item of toIterable(data)) changed = this.hidden.delete(item) || changed;
    if (changed) this.notify();
  }

  /** 指定時点の要素集合を隔離する。後からselectが変わっても隔離集合は変わらない。 */
  isolate(data: DocumentData | Iterable<DocumentData>): void {
    this.isolated.clear();
    for (const item of toIterable(data)) this.isolated.add(item);
    this.modeValue = 'isolate';
    this.notify();
  }

  /** 候補の現在選択中要素を隔離し、その件数を返す。 */
  isolateSelected(candidates: Iterable<DocumentData>): number {
    const selected: DocumentData[] = [];
    for (const data of candidates) {
      if (data.select) selected.push(data);
    }
    if (selected.length === 0) return 0;
    this.isolated.clear();
    for (const data of selected) this.isolated.add(data);
    this.modeValue = 'isolate';
    this.notify();
    return this.isolated.size;
  }

  clearIsolation(): void {
    if (this.modeValue !== 'isolate' && this.isolated.size === 0) return;
    this.modeValue = 'all';
    this.isolated.clear();
    this.notify();
  }

  /** 非表示・隔離をすべて解除し、通常表示へ戻す。 */
  showAll(): void {
    if (this.modeValue === 'all' && this.hidden.size === 0 && this.isolated.size === 0) return;
    this.modeValue = 'all';
    this.hidden.clear();
    this.isolated.clear();
    this.notify();
  }

  /** Document差替え後に、存在しない要素への参照を破棄する。 */
  prune(validData: Iterable<DocumentData>): void {
    const valid = new Set(validData);
    let changed = false;
    for (const data of this.hidden) {
      if (!valid.has(data)) changed = this.hidden.delete(data) || changed;
    }
    for (const data of this.isolated) {
      if (!valid.has(data)) changed = this.isolated.delete(data) || changed;
    }
    // undo/importは全要素を新しいobjectへ差し替える。隔離参照が全て失効したら
    // 空のisolate modeへ残してモデル全体を不可視にせず、通常表示へ戻す。
    if (this.modeValue === 'isolate' && this.isolated.size === 0) {
      this.modeValue = 'all';
      changed = true;
    }
    if (changed) this.notify();
  }

  allows(data: DocumentData): boolean {
    if (this.hidden.has(data)) return false;
    if (this.modeValue === 'selectedOnly') return data.select;
    if (this.modeValue === 'isolate') return this.isolated.has(data);
    return true;
  }

  private notify(): void {
    const snapshot = this.settings;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

function toIterable(data: DocumentData | Iterable<DocumentData>): Iterable<DocumentData> {
  return Symbol.iterator in Object(data) ? (data as Iterable<DocumentData>) : [data as DocumentData];
}
