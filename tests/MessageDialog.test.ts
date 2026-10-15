// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import {
  addButtonRow,
  addFormRow,
  createDialogBox,
  createModalOverlay,
  wireDialog,
} from '../src/ui/dialogs/DialogUtil';
import { showChoiceDialog, showConfirmDialog, showMessageDialog } from '../src/ui/dialogs/MessageDialog';
import { MessageLog, messageLog } from '../src/ui/MessageLog';

function dialog(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!element) throw new Error('dialog is not open');
  return element;
}

function buttons(): HTMLButtonElement[] {
  return [...dialog().querySelectorAll<HTMLButtonElement>('button')];
}

function keydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  setLocale('ja');
  messageLog.clear();
});

afterEach(() => {
  while (document.querySelector('.modal-overlay')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
});

describe('MessageLog', () => {
  it('keeps the newest entries first and trims to the limit', () => {
    let now = 1000;
    const log = new MessageLog(2, () => now++);
    log.record('info', 'first');
    log.record('warning', 'second');
    log.record('error', 'third');
    expect(log.size).toBe(2);
    expect(log.recent.map((entry) => entry.text)).toEqual(['third', 'second']);
    expect(log.recent[0]).toMatchObject({ level: 'error', time: 1002 });
    log.clear();
    expect(log.size).toBe(0);
  });
});

describe('in-app message dialogs', () => {
  it('shows a message as an accessible dialog, records it and closes with the button', async () => {
    const promise = showMessageDialog('壁 2 が平面でなくなります', { level: 'error' });
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().querySelector('h3')?.textContent).toBe('エラー');
    expect(dialog().querySelector('.dialog-message')?.textContent).toBe('壁 2 が平面でなくなります');
    expect(messageLog.recent[0]).toMatchObject({ level: 'error', text: '壁 2 が平面でなくなります' });

    buttons()[0].click();
    await expect(promise).resolves.toBeUndefined();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('resolves confirm with the chosen button and false on Escape', async () => {
    const accepted = showConfirmDialog('削除しますか？', { okLabel: '削除', danger: true });
    const [cancel, ok] = buttons();
    expect([cancel.textContent, ok.textContent]).toEqual(['キャンセル', '削除']);
    expect(ok.classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(ok);
    ok.click();
    await expect(accepted).resolves.toBe(true);

    const declined = showConfirmDialog('削除しますか？');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(declined).resolves.toBe(false);
  });

  it('offers several choices, picks the primary one with Enter and returns null when dismissed', async () => {
    const chosen = showChoiceDialog<'a' | 'b' | 'c'>('どうしますか？', [
      { label: 'あとで', value: 'a' },
      { label: '破棄', value: 'b', danger: true },
      { label: '復旧', value: 'c', primary: true },
    ]);
    expect(buttons().map((button) => button.textContent)).toEqual(['あとで', '破棄', '復旧']);
    keydown(dialog(), { key: 'Enter' });
    await expect(chosen).resolves.toBe('c');

    const dismissed = showChoiceDialog('どうしますか？', [{ label: 'OK', value: 1 }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(dismissed).resolves.toBeNull();
  });

  it('does not close when the backdrop outside the dialog is clicked', async () => {
    const promise = showConfirmDialog('続けますか？');
    const overlay = document.querySelector<HTMLElement>('.modal-overlay')!;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    buttons()[1].click();
    await expect(promise).resolves.toBe(true);
  });
});

describe('dialog text entry', () => {
  it('selects the default text on initial focus and keeps Ctrl/Cmd+A inside the field', async () => {
    const overlay = createModalOverlay();
    const box = createDialogBox('Properties');
    const input = addFormRow(box, 'Section', 'text', 'G1');
    const { okBtn, cancelBtn } = addButtonRow(box);
    overlay.appendChild(box);
    const result = wireDialog(overlay, okBtn, cancelBtn, () => true);

    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);

    input.setSelectionRange(2, 2);
    const metaA = keydown(input, { key: 'a', metaKey: true });
    expect(metaA.defaultPrevented).toBe(true);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);

    input.setSelectionRange(1, 1);
    keydown(input, { key: 'A', ctrlKey: true });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);

    // 入力欄以外では既定動作に任せる。
    expect(keydown(okBtn, { key: 'a', metaKey: true }).defaultPrevented).toBe(false);

    cancelBtn.click();
    await expect(result).resolves.toBe(false);
  });
});
