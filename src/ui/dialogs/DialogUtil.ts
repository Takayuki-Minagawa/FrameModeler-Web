/** モーダルダイアログのベースユーティリティ */
import { t } from '../../i18n';

let dialogId = 0;
let controlId = 0;

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.tabIndex = -1;

  const h3 = document.createElement('h3');
  h3.id = `dialog-title-${++dialogId}`;
  h3.textContent = title;
  box.setAttribute('aria-labelledby', h3.id);
  box.appendChild(h3);
  return box;
}

/** フォーム行を追加 */
export function addFormRow(
  container: HTMLElement,
  label: string,
  inputType: string,
  value: string,
  readonly: boolean = false,
): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'form-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  const id = `dialog-control-${++controlId}`;
  lbl.htmlFor = id;
  row.appendChild(lbl);

  const input = document.createElement('input');
  input.id = id;
  input.type = inputType;
  input.value = value;
  if (inputType === 'number') {
    input.step = 'any';
    input.required = !readonly;
  }
  if (readonly) input.readOnly = true;
  input.addEventListener('input', () => clearFieldError(input));
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
export function addSelectRow(
  container: HTMLElement,
  label: string,
  options: string[],
  selected: string,
): HTMLSelectElement {
  const row = document.createElement('div');
  row.className = 'form-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  const id = `dialog-control-${++controlId}`;
  lbl.htmlFor = id;
  row.appendChild(lbl);

  const select = document.createElement('select');
  select.id = id;
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
  cancelBtn.type = 'button';
  cancelBtn.textContent = t('cancel');
  row.appendChild(cancelBtn);

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
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
  closeBtn.type = 'button';
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
  onShown?: (dismiss: (result: T) => void) => void,
): { promise: Promise<T>; dismiss: (result: T) => void } {
  let resolveFunc!: (result: T) => void;
  let closed = false;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = overlay.querySelector<HTMLElement>('[role="dialog"]');
  const backgroundElements = Array.from(document.body.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
    .map((element) => ({ element, wasInert: element.inert }));

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismiss(defaultResult);
      return;
    }

    if (e.key !== 'Tab' || !dialog) return;

    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const dismiss = (result: T): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    backgroundElements.forEach(({ element, wasInert }) => {
      element.inert = wasInert;
    });
    overlay.remove();
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
    resolveFunc(result);
  };

  const promise = new Promise<T>((resolve) => {
    resolveFunc = resolve;
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss(defaultResult);
  });
  document.addEventListener('keydown', onKeydown, true);

  document.body.appendChild(overlay);
  backgroundElements.forEach(({ element }) => {
    element.inert = true;
  });
  if (onShown) onShown(dismiss);
  if (!dialog?.contains(document.activeElement)) focusInitialElement(dialog);
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

  const confirm = (): void => {
    if (onOk()) {
      dismiss(true);
      return;
    }

    const invalid = overlay.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(':invalid');
    invalid?.focus();
    invalid?.reportValidity();
  };

  okBtn.addEventListener('click', confirm);
  cancelBtn.addEventListener('click', () => dismiss(false));
  overlay.addEventListener('keydown', (event) => {
    if (
      event.key !== 'Enter' ||
      event.isComposing ||
      event.defaultPrevented ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    )
      return;

    event.preventDefault();
    confirm();
  });

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

/** 数値入力を有限値として読み取り、エラーを入力欄の直下へ表示する。 */
export function readFiniteNumber(input: HTMLInputElement): number | null {
  const value = input.valueAsNumber;
  if (input.value.trim() !== '' && Number.isFinite(value)) {
    clearFieldError(input);
    return value;
  }

  const message = t('validation.finiteNumber');
  input.setCustomValidity(message);
  input.setAttribute('aria-invalid', 'true');

  const row = input.closest('.form-row');
  if (row) {
    let error = row.querySelector<HTMLElement>('.field-error');
    if (!error) {
      error = document.createElement('span');
      error.className = 'field-error';
      error.id = `${input.id}-error`;
      error.setAttribute('role', 'alert');
      row.appendChild(error);
    }
    error.textContent = message;
    input.setAttribute('aria-errormessage', error.id);
  }

  input.focus();
  input.reportValidity();
  return null;
}

function clearFieldError(input: HTMLInputElement): void {
  input.setCustomValidity('');
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-errormessage');
  input.closest('.form-row')?.querySelector('.field-error')?.remove();
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return (
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  });
}

function focusInitialElement(dialog: HTMLElement | null): void {
  if (!dialog) return;
  const preferred = dialog.querySelector<HTMLElement>(
    '[autofocus], input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])',
  );
  (preferred ?? getFocusableElements(dialog)[0] ?? dialog).focus();
}
