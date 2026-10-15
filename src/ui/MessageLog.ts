/** ステータスバー通知やダイアログで表示したメッセージを後から読み返すための履歴。 */
export type MessageLevel = 'info' | 'warning' | 'error';

export interface MessageLogEntry {
  readonly time: number;
  readonly level: MessageLevel;
  readonly text: string;
}

export type MessageLogListener = (entries: ReadonlyArray<MessageLogEntry>) => void;

/** 直近 N 件のメッセージを保持する。DOM に依存せず、ステータスバー・ダイアログ双方から記録できる。 */
export class MessageLog {
  private readonly entries: MessageLogEntry[] = [];
  private readonly listeners = new Set<MessageLogListener>();

  constructor(
    private readonly limit: number = 100,
    private readonly now: () => number = () => Date.now(),
  ) {}

  record(level: MessageLevel, text: string): MessageLogEntry {
    const entry: MessageLogEntry = { time: this.now(), level, text };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    for (const listener of [...this.listeners]) listener(this.entries);
    return entry;
  }

  /** 新しいものが先頭になるよう逆順で返す。 */
  get recent(): ReadonlyArray<MessageLogEntry> {
    return [...this.entries].reverse();
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
    for (const listener of [...this.listeners]) listener(this.entries);
  }

  subscribe(listener: MessageLogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** アプリ全体で共有する既定の履歴。テストでは個別の MessageLog を生成してもよい。 */
export const messageLog = new MessageLog();
