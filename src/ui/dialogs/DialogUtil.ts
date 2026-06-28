/** モーダルダイアログのベースユーティリティ */
import { t } from '../../i18n';

/** モーダルオーバーレイを作成 */
export function createModalOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  return overlay;
}

/** ダイアログボックスを作成 */
export function createDialogBox(title: string): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'modal-dialog';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  box.appendChild(h3);
  return box;
}

/** フォーム行を追加 */
export function addFormRow(container: HTMLElement, label: string, inputType: string, value: string, readonly: boolean = false): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'form-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  row.appendChild(lbl);

  const input = document.createElement('input');
  input.type = inputType;
  input.value = value;
  if (readonly) input.readOnly = true;
  row.appendChild(input);

  container.appendChild(row);
  return input;
}

/** 読み取り専用のノード表示行を追加（番号と座標） */
export function addNodeRow(
  container: HTMLElement,
  label: string,
  node: import('../../data/Node').Node,
): HTMLInputElement {
  return addFormRow(container, label, 'text', `${node.number} (${node.pos.toString()})`, true);
}

/** セレクト行を追加 */
export function addSelectRow(container: HTMLElement, label: string, options: string[], selected: string): HTMLSelectElement {
  const row = document.createElement('div');
  row.className = 'form-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  row.appendChild(lbl);

  const select = document.createElement('select');
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    if (opt === selected) option.selected = true;
    select.appendChild(option);
  }
  row.appendChild(select);

  container.appendChild(row);
  return select;
}

/** OK/キャンセルボタン行を追加 */
export function addButtonRow(container: HTMLElement): { okBtn: HTMLButtonElement; cancelBtn: HTMLButtonElement } {
  const row = document.createElement('div');
  row.className = 'button-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = t('cancel');
  row.appendChild(cancelBtn);

  const okBtn = document.createElement('button');
  okBtn.textContent = t('ok');
  okBtn.className = 'primary';
  row.appendChild(okBtn);

  container.appendChild(row);
  return { okBtn, cancelBtn };
}

/** 閉じるボタンのみの行を追加 */
export function addCloseButtonRow(container: HTMLElement): HTMLButtonElement {
  const row = document.createElement('div');
  row.className = 'button-row';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = t('close');
  closeBtn.className = 'primary';
  row.appendChild(closeBtn);

  container.appendChild(row);
  return closeBtn;
}

/**
 * ESC・オーバーレイクリックで閉じられるモーダルとして overlay を表示する共通基盤。
 * dismiss(result) は (a) ESCリスナ除去 (b) overlay除去 (c) resolve を必ずセットで行い、
 * リスナ漏れ・Promise未解決リークを防ぐ。
 */
export function showModalBase<T>(
  overlay: HTMLDivElement,
  defaultResult: T,
  onDismiss?: (dismiss: (result: T) => void) => void,
): { promise: Promise<T>; dismiss: (result: T) => void } {
  let resolveFunc!: (result: T) => void;
  let closed = false;

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss(defaultResult);
  };

  const dismiss = (result: T): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    resolveFunc(result);
  };

  const promise = new Promise<T>((resolve) => {
    resolveFunc = resolve;
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss(defaultResult);
  });
  document.addEventListener('keydown', onKeydown);

  document.body.appendChild(overlay);
  if (onDismiss) onDismiss(dismiss);
  return { promise, dismiss };
}

/**
 * OK/キャンセル付きモーダルダイアログの共通ライフサイクル。
 * - overlay を document.body に append。
 * - OKクリック時 onOk() が true を返したら dismiss(true)、false なら閉じない。
 * - Cancelクリック / ESC / オーバーレイクリックで dismiss(false)。
 * @returns OKで確定したら true、キャンセル/閉じたら false を解決する Promise。
 */
export function wireDialog(
  overlay: HTMLDivElement,
  okBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  onOk: () => boolean,
): Promise<boolean> {
  const { promise, dismiss } = showModalBase(overlay, false);

  okBtn.addEventListener('click', () => {
    if (onOk()) dismiss(true);
  });
  cancelBtn.addEventListener('click', () => dismiss(false));

  return promise;
}

/**
 * 閉じるボタンのみのモーダル（Help用）。
 * 閉じるボタン / ESC / オーバーレイクリックで閉じる。
 */
export function showModal(overlay: HTMLDivElement, closeBtn: HTMLButtonElement): Promise<boolean> {
  const { promise, dismiss } = showModalBase(overlay, false);
  closeBtn.addEventListener('click', () => dismiss(false));
  return promise;
}
