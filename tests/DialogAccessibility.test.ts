// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setLocale, updateDom } from '../src/i18n';
import {
  addButtonRow,
  addFormRow,
  addSelectRow,
  createDialogBox,
  createModalOverlay,
  readFiniteNumber,
  wireDialog,
} from '../src/ui/dialogs/DialogUtil';

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  setLocale('ja');
});

afterEach(() => {
  const overlay = document.querySelector<HTMLElement>('.modal-overlay');
  if (overlay) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('dialog accessibility', () => {
  it('associates the title and form labels with their controls', async () => {
    const overlay = createModalOverlay();
    const box = createDialogBox('Properties');
    const input = addFormRow(box, 'X', 'number', '10');
    const select = addSelectRow(box, 'Direction', ['X', 'Y'], 'Y');
    const { okBtn, cancelBtn } = addButtonRow(box);
    overlay.appendChild(box);

    const result = wireDialog(overlay, okBtn, cancelBtn, () => true);

    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(box.getAttribute('aria-labelledby')).toBe(box.querySelector('h3')?.id);
    expect(box.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    expect(box.querySelector(`label[for="${select.id}"]`)).not.toBeNull();
    expect(document.activeElement).toBe(input);

    cancelBtn.click();
    await expect(result).resolves.toBe(false);
  });

  it('traps Tab focus, closes on Escape, and restores the opener focus', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const overlay = createModalOverlay();
    const box = createDialogBox('Properties');
    const input = addFormRow(box, 'Name', 'text', 'A');
    const { okBtn, cancelBtn } = addButtonRow(box);
    overlay.appendChild(box);
    const result = wireDialog(overlay, okBtn, cancelBtn, () => true);

    okBtn.focus();
    okBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(okBtn);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(cancelBtn.isConnected).toBe(false);
  });

  it('confirms an editable field with Enter', async () => {
    const overlay = createModalOverlay();
    const box = createDialogBox('Properties');
    const input = addFormRow(box, 'Name', 'text', 'A');
    const { okBtn, cancelBtn } = addButtonRow(box);
    overlay.appendChild(box);
    const onOk = vi.fn(() => true);
    const result = wireDialog(overlay, okBtn, cancelBtn, onOk);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await expect(result).resolves.toBe(true);
    expect(onOk).toHaveBeenCalledOnce();
  });

  it('shows an inline error for a non-finite numeric input', () => {
    const box = createDialogBox('Properties');
    const input = addFormRow(box, 'X', 'number', '');
    document.body.appendChild(box);

    expect(readFiniteNumber(input)).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(box.querySelector('.field-error')?.textContent).toBe('有限の数値を入力してください');

    input.value = '12.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readFiniteNumber(input)).toBe(12.5);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(box.querySelector('.field-error')).toBeNull();
  });
});

describe('page accessibility and locale', () => {
  it('synchronizes html lang and translated accessible names', () => {
    document.body.innerHTML = '<button data-i18n-aria-label="aria.toolbar"></button>';

    setLocale('en');
    updateDom();

    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('Drawing toolbar');
  });

  it('provides static semantics for the toolbar, layers, and CAD canvas', () => {
    const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    expect(parsed.querySelector('#toolbar')?.getAttribute('role')).toBe('toolbar');
    expect(parsed.querySelector('#layer-list')?.getAttribute('role')).toBe('listbox');
    expect(parsed.querySelector('#cad-canvas')?.getAttribute('tabindex')).toBe('0');
    expect(parsed.querySelector('#cad-canvas')?.getAttribute('aria-label')).toBeTruthy();
    expect(parsed.querySelector('#btn-select')?.getAttribute('aria-pressed')).toBe('true');
  });
});
