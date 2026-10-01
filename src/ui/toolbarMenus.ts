/**
 * ツールバーの <details class="toolbar-menu"> を一般的なメニューとして振る舞わせる。
 * - 1つ開いたら他は閉じる
 * - メニュー外のクリック、Esc、メニュー内のボタン実行で閉じる
 * チェックボックスの切替では閉じないため、選択対象やラベルは続けて操作できる。
 */
export function installToolbarMenus(root: Document = document): () => void {
  const menus = (): HTMLDetailsElement[] => [...root.querySelectorAll<HTMLDetailsElement>('details.toolbar-menu')];
  const closeAll = (except?: Element | null): void => {
    for (const menu of menus()) {
      if (menu !== except) menu.open = false;
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
    open.open = false;
    open.querySelector<HTMLElement>('summary')?.focus();
  };

  // toggle はbubbleしないためcaptureで受ける。
  root.addEventListener('toggle', onToggle, true);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);
  return () => {
    root.removeEventListener('toggle', onToggle, true);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown);
  };
}
