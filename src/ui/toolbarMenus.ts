/**
 * ツールバーの <details class="toolbar-menu"> を一般的なメニューとして振る舞わせる。
 * - 1つ開いたら他は閉じる
 * - メニュー外のクリック、Esc、メニュー内のボタン実行で閉じる
 * - 閉じるときにフォーカスがメニュー内に残っていれば、見出しへ戻す
 * チェックボックスの切替では閉じないため、選択対象やラベルは続けて操作できる。
 */
export function installToolbarMenus(root: Document = document): () => void {
  const menus = (): HTMLDetailsElement[] => [...root.querySelectorAll<HTMLDetailsElement>('details.toolbar-menu')];
  const close = (menu: HTMLDetailsElement): void => {
    if (!menu.open) return;
    // 閉じると中のボタンは非表示になる。フォーカスを見出しへ移し、キーボード操作を続けられるようにする。
    const hadFocus = menu.contains(root.activeElement) && root.activeElement !== menu.querySelector('summary');
    menu.open = false;
    if (hadFocus) menu.querySelector<HTMLElement>(':scope > summary')?.focus();
  };
  const closeAll = (except?: Element | null): void => {
    for (const menu of menus()) {
      if (menu !== except) close(menu);
    }
  };

  const onToggle = (event: Event): void => {
    const menu = event.target as HTMLDetailsElement;
    if (menu.matches?.('details.toolbar-menu') && menu.open) closeAll(menu);
  };
  const onPointerDown = (event: Event): void => {
    const inside = (event.target as Element | null)?.closest?.('details.toolbar-menu') ?? null;
    closeAll(inside);
  };
  const onClick = (event: Event): void => {
    const button = (event.target as Element | null)?.closest?.('.toolbar-popover button');
    if (button) closeAll();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    const open = menus().find((menu) => menu.open && menu.contains(root.activeElement));
    if (!open) return;
    // メニューを閉じるためのEscで、作図中の操作まで取り消さない。
    event.preventDefault();
    open.open = false;
    open.querySelector<HTMLElement>(':scope > summary')?.focus();
  };

  // toggle はbubbleしないためcaptureで受ける。
  root.addEventListener('toggle', onToggle, true);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('click', onClick);
  // 他のキーボードショートカットより先に処理できるようcaptureで受ける。
  root.addEventListener('keydown', onKeydown, true);
  return () => {
    root.removeEventListener('toggle', onToggle, true);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown, true);
  };
}
