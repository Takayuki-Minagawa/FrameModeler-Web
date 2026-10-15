import { t } from '../../i18n';
import { messageLog, type MessageLevel } from '../MessageLog';
import { createDialogBox, createModalOverlay, showModalBase } from './DialogUtil';

/**
 * ブラウザ標準の alert / confirm の代替。
 * 自動操作環境や組込みブラウザでは標準ダイアログが黙って閉じられて内容を読めないため、
 * 他のダイアログと同じ role=dialog のアプリ内ダイアログへ統一し、内容を履歴にも残す。
 */

export interface MessageDialogOptions {
  title?: string;
  level?: MessageLevel;
  closeLabel?: string;
}

export interface ConfirmDialogOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** 破棄・削除など取り消しにくい操作では OK ボタンを danger 表示にする。 */
  danger?: boolean;
}

export interface DialogChoice<T> {
  readonly label: string;
  readonly value: T;
  /** 既定（Enter で選ばれる）ボタン。1つだけ指定する。 */
  readonly primary?: boolean;
  readonly danger?: boolean;
}

export interface ChoiceDialogOptions {
  title?: string;
  level?: MessageLevel;
}

/** 情報・エラーを1ボタンで表示する。閉じるまで待てる。 */
export function showMessageDialog(message: string, options: MessageDialogOptions = {}): Promise<void> {
  const level = options.level ?? 'info';
  messageLog.record(level, message);
  const overlay = createModalOverlay();
  const box = createDialogBox(options.title ?? t(level === 'error' ? 'dialog.error' : 'dialog.message'));
  box.classList.add('message-dialog', `message-${level}`);
  const body = createMessageBody(message);
  box.setAttribute('aria-describedby', body.id);
  box.appendChild(body);
  const row = document.createElement('div');
  row.className = 'button-row';
  const closeBtn = createButton(options.closeLabel ?? t('close'), 'primary');
  row.appendChild(closeBtn);
  box.appendChild(row);
  overlay.appendChild(box);

  const { promise, dismiss } = showModalBase<void>(overlay, undefined);
  closeBtn.addEventListener('click', () => dismiss());
  return promise;
}

/** OK / キャンセルの2択。Esc は キャンセル。 */
export async function showConfirmDialog(message: string, options: ConfirmDialogOptions = {}): Promise<boolean> {
  const result = await showChoiceDialog<boolean>(
    message,
    [
      { label: options.cancelLabel ?? t('cancel'), value: false },
      { label: options.okLabel ?? t('ok'), value: true, primary: true, danger: options.danger },
    ],
    { title: options.title ?? t('dialog.confirm'), level: 'info' },
  );
  return result === true;
}

/** 任意個数の選択肢を持つダイアログ。Esc または閉じた場合は null。 */
export function showChoiceDialog<T>(
  message: string,
  choices: ReadonlyArray<DialogChoice<T>>,
  options: ChoiceDialogOptions = {},
): Promise<T | null> {
  const level = options.level ?? 'info';
  messageLog.record(level, message);
  const overlay = createModalOverlay();
  const box = createDialogBox(options.title ?? t('dialog.confirm'));
  box.classList.add('message-dialog', `message-${level}`);
  const body = createMessageBody(message);
  box.setAttribute('aria-describedby', body.id);
  box.appendChild(body);
  const row = document.createElement('div');
  row.className = 'button-row';
  const buttons = choices.map((choice) => {
    const button = createButton(choice.label, choice.primary ? 'primary' : '');
    if (choice.danger) button.classList.add('danger');
    row.appendChild(button);
    return { button, choice };
  });
  box.appendChild(row);
  overlay.appendChild(box);

  const { promise, dismiss } = showModalBase<T | null>(overlay, null, () => {
    // 初期フォーカスは既定ボタン。無ければ最後のボタン。
    const primary = buttons.find(({ choice }) => choice.primary) ?? buttons[buttons.length - 1];
    primary?.button.focus();
  });
  for (const { button, choice } of buttons) {
    button.addEventListener('click', () => dismiss(choice.value));
  }
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.target instanceof HTMLButtonElement) return;
    const primary = buttons.find(({ choice }) => choice.primary);
    if (!primary) return;
    event.preventDefault();
    dismiss(primary.choice.value);
  });
  return promise;
}

let messageId = 0;

function createMessageBody(message: string): HTMLParagraphElement {
  const body = document.createElement('p');
  body.className = 'dialog-message';
  body.id = `dialog-message-${++messageId}`;
  body.textContent = message;
  return body;
}

function createButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  return button;
}
