// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutController, type ShortcutActions } from '../src/controllers/ShortcutController';

let controller: ShortcutController;
let actions: { [K in keyof ShortcutActions]: ReturnType<typeof vi.fn> };
let canvas: HTMLCanvasElement;

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML =
    '<canvas id="canvas" tabindex="0"></canvas><input id="text" /><button id="button"></button>' +
    '<input id="check" type="checkbox" /><select id="select"><option>a</option></select>';
  canvas = document.querySelector('canvas')!;
  actions = {
    save: vi.fn(),
    open: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cancel: vi.fn(),
    deleteSelection: vi.fn(),
    selectAll: vi.fn(),
    invertSelection: vi.fn(),
    arrayCopy: vi.fn(),
    fit: vi.fn(),
    activateTool: vi.fn((index: number) => index <= 3),
    cycleSnap: vi.fn(() => true),
  };
  controller = new ShortcutController({ actions: actions as unknown as ShortcutActions, canvas, root: document });
  controller.connect();
});

afterEach(() => controller.dispose());

describe('ShortcutController', () => {
  it('maps command shortcuts for file, history, selection and copy on both Ctrl and Cmd', () => {
    const cases: Array<[KeyboardEventInit, keyof ShortcutActions]> = [
      [{ key: 's', ctrlKey: true }, 'save'],
      [{ key: 'O', metaKey: true }, 'open'],
      [{ key: 'z', ctrlKey: true }, 'undo'],
      [{ key: 'z', metaKey: true, shiftKey: true }, 'redo'],
      [{ key: 'y', ctrlKey: true }, 'redo'],
      [{ key: 'a', ctrlKey: true }, 'selectAll'],
      [{ key: 'i', metaKey: true }, 'invertSelection'],
      [{ key: 'd', ctrlKey: true }, 'arrayCopy'],
    ];
    for (const [init, action] of cases) {
      actions[action].mockClear();
      const event = press(init);
      expect(actions[action], JSON.stringify(init)).toHaveBeenCalledOnce();
      expect(event.defaultPrevented, JSON.stringify(init)).toBe(true);
    }
  });

  it('maps plain keys for delete, fit and tools', () => {
    expect(press({ key: 'Delete' }).defaultPrevented).toBe(true);
    expect(actions.deleteSelection).toHaveBeenCalledOnce();

    press({ key: 'Home' });
    press({ key: 'F' });
    expect(actions.fit).toHaveBeenCalledTimes(2);

    expect(press({ key: '2' }).defaultPrevented).toBe(true);
    expect(actions.activateTool).toHaveBeenLastCalledWith(2);
    // 対応するツールが無い番号は、ブラウザ既定の動作を妨げない。
    expect(press({ key: '9' }).defaultPrevented).toBe(false);
    expect(actions.activateTool).toHaveBeenLastCalledWith(9);
  });

  it('leaves unrelated and browser shortcuts alone', () => {
    expect(press({ key: 'f', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press({ key: '1', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press({ key: '1', altKey: true }).defaultPrevented).toBe(false);
    expect(press({ key: 'x' }).defaultPrevented).toBe(false);
    expect(actions.fit).not.toHaveBeenCalled();
    expect(actions.activateTool).not.toHaveBeenCalled();
  });

  it('cancels on Escape without blocking the default action, even while editing text', () => {
    const input = document.querySelector<HTMLInputElement>('#text')!;
    expect(press({ key: 'Escape' }, input).defaultPrevented).toBe(false);
    expect(actions.cancel).toHaveBeenCalledOnce();
  });

  it('ignores other shortcuts while typing, during IME composition and when a modal is open', () => {
    const input = document.querySelector<HTMLInputElement>('#text')!;
    press({ key: 'Delete' }, input);
    press({ key: 'a', ctrlKey: true }, input);
    press({ key: '1' }, input);
    press({ key: 'Delete', isComposing: true });
    expect(actions.deleteSelection).not.toHaveBeenCalled();
    expect(actions.selectAll).not.toHaveBeenCalled();
    expect(actions.activateTool).not.toHaveBeenCalled();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
    press({ key: 'Delete' });
    press({ key: 'Escape' });
    expect(actions.deleteSelection).not.toHaveBeenCalled();
    expect(actions.cancel).not.toHaveBeenCalled();
  });

  it('keeps working after a checkbox or button was clicked, but not inside a select', () => {
    const check = document.querySelector<HTMLInputElement>('#check')!;
    check.focus();
    expect(press({ key: 'a', ctrlKey: true }, check).defaultPrevented).toBe(true);
    expect(actions.selectAll).toHaveBeenCalledOnce();
    press({ key: '3' }, check);
    expect(actions.activateTool).toHaveBeenLastCalledWith(3);

    press({ key: 'Delete' }, document.querySelector('#button')!);
    expect(actions.deleteSelection).toHaveBeenCalledOnce();

    // select は矢印キーや文字キーを自分で使う。
    press({ key: '1' }, document.querySelector('#select')!);
    expect(actions.activateTool).toHaveBeenCalledTimes(1);
  });

  it('leaves Shift combinations to the browser except redo', () => {
    for (const key of ['a', 'i', 'd', 's', 'o', 'y']) {
      expect(press({ key, ctrlKey: true, shiftKey: true }).defaultPrevented, key).toBe(false);
    }
    expect(actions.selectAll).not.toHaveBeenCalled();
    expect(actions.invertSelection).not.toHaveBeenCalled();
    expect(actions.arrayCopy).not.toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.redo).not.toHaveBeenCalled();

    expect(press({ key: 'Z', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(actions.redo).toHaveBeenCalledOnce();
  });

  it('cycles snap candidates with Tab only while the canvas has focus', () => {
    const button = document.querySelector<HTMLButtonElement>('#button')!;
    button.focus();
    expect(press({ key: 'Tab' }, button).defaultPrevented).toBe(false);
    expect(actions.cycleSnap).not.toHaveBeenCalled();

    canvas.focus();
    expect(press({ key: 'Tab' }, canvas).defaultPrevented).toBe(true);
    expect(actions.cycleSnap).toHaveBeenLastCalledWith(1);
    press({ key: 'Tab', shiftKey: true }, canvas);
    expect(actions.cycleSnap).toHaveBeenLastCalledWith(-1);

    // 切り替える候補が無いときは、Tabを通常のフォーカス移動として通す。
    actions.cycleSnap.mockReturnValueOnce(false);
    expect(press({ key: 'Tab' }, canvas).defaultPrevented).toBe(false);
  });

  it('skips events another handler already consumed and stops after dispose', () => {
    const consumed = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    document.body.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    document.body.dispatchEvent(consumed);
    expect(actions.deleteSelection).not.toHaveBeenCalled();

    controller.dispose();
    press({ key: 'Delete' });
    expect(actions.deleteSelection).not.toHaveBeenCalled();
  });
});
