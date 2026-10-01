export interface ShortcutActions {
  save(): void;
  open(): void;
  undo(): void;
  redo(): void;
  cancel(): void;
  deleteSelection(): void;
  selectAll(): void;
  invertSelection(): void;
  arrayCopy(): void;
  fit(): void;
  /** 1始まりのツール番号。対応するツールが無ければ false を返す。 */
  activateTool(index: number): boolean;
  /** canvasにフォーカスがあるときのTab。direction は +1 / -1。 */
  cycleSnap(direction: number): void;
}

export interface ShortcutControllerOptions {
  actions: ShortcutActions;
  canvas: HTMLElement;
  root?: Document;
}

/**
 * アプリ全体のキーボードショートカット。
 * モーダル表示中は何もしない。入力欄で文字を編集している間は Esc だけを受け付ける。
 */
export class ShortcutController {
  private readonly root: Document;
  private readonly onKeydown = (event: KeyboardEvent): void => this.handle(event);

  constructor(private readonly options: ShortcutControllerOptions) {
    this.root = options.root ?? document;
  }

  connect(): void {
    this.root.addEventListener('keydown', this.onKeydown);
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.onKeydown);
  }

  private handle(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    if (this.root.querySelector('.modal-overlay')) return;
    const target = event.target as HTMLElement | null;
    const editingText = target?.matches?.('input, textarea, select, [contenteditable="true"]') ?? false;
    // 数値入力の途中でも、Escによる作図の取消だけは受け付ける。
    if (editingText && event.key !== 'Escape') return;

    const action = this.resolve(event);
    if (!action) return;
    if (action() !== false) event.preventDefault();
  }

  /** 実行する処理を返す。処理が false を返した場合はブラウザ既定の動作を妨げない。 */
  private resolve(event: KeyboardEvent): (() => unknown) | null {
    const { actions, canvas } = this.options;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const command = event.ctrlKey || event.metaKey;

    if (command && !event.altKey) {
      switch (key) {
        case 's':
          return () => actions.save();
        case 'o':
          return () => actions.open();
        case 'z':
          return () => (event.shiftKey ? actions.redo() : actions.undo());
        case 'y':
          return () => actions.redo();
        case 'a':
          return () => actions.selectAll();
        case 'i':
          return () => actions.invertSelection();
        case 'd':
          return () => actions.arrayCopy();
        default:
          return null;
      }
    }
    if (event.altKey) return null;

    if (key === 'Escape') {
      // Escは開いているメニューを閉じる既定動作も妨げない。
      return () => {
        actions.cancel();
        return false;
      };
    }
    if (key === 'Delete') return () => actions.deleteSelection();
    if (key === 'Home' || key === 'f') return () => actions.fit();
    if (key === 'Tab' && this.root.activeElement === canvas) return () => actions.cycleSnap(event.shiftKey ? -1 : 1);
    if (/^[1-9]$/.test(key) && !event.shiftKey) return () => actions.activateTool(Number(key));
    return null;
  }
}
