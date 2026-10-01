// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoordinateEntryController } from '../src/controllers/CoordinateEntryController';
import { ToolController, TOOL_BUTTON_IDS } from '../src/controllers/ToolController';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { setLocale } from '../src/i18n';
import { Point3D } from '../src/math/Point3D';
import type { CadView } from '../src/ui/CadView';
import { addButtonRow, createDialogBox, createModalOverlay, wireDialog } from '../src/ui/dialogs/DialogUtil';
import { byId } from '../src/ui/dom';
import type { ICadMouseHandler } from '../src/ui/handlers/ICadMouseHandler';
import { MeasureHandler } from '../src/ui/handlers/MeasureHandler';
import { SelectionHandler } from '../src/ui/handlers/SelectionHandler';
import { installToolbarMenus } from '../src/ui/toolbarMenus';

const doc = Document.instance;

beforeEach(() => {
  doc.init();
  localStorage.clear();
  setLocale('ja');
  document.body.innerHTML = '';
});

afterEach(() => vi.restoreAllMocks());

describe('byId', () => {
  it('returns the element or fails fast with the missing id', () => {
    document.body.innerHTML = '<input id="present" />';
    expect(byId<HTMLInputElement>('present').tagName).toBe('INPUT');
    expect(() => byId('absent')).toThrow('Element not found: #absent');
  });
});

describe('installToolbarMenus', () => {
  let dispose: () => void;
  let first: HTMLDetailsElement;
  let second: HTMLDetailsElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <details class="toolbar-menu" id="first">
        <summary>First</summary>
        <div class="toolbar-popover">
          <button id="action" type="button">Run</button>
          <label><input id="check" type="checkbox" /> Option</label>
        </div>
      </details>
      <details class="toolbar-menu" id="second"><summary>Second</summary><div class="toolbar-popover"></div></details>
      <button id="outside" type="button">Outside</button>
    `;
    first = document.querySelector('#first')!;
    second = document.querySelector('#second')!;
    dispose = installToolbarMenus(document);
  });

  afterEach(() => dispose());

  function open(menu: HTMLDetailsElement): void {
    menu.open = true;
    menu.dispatchEvent(new Event('toggle'));
  }

  it('keeps only one menu open at a time', () => {
    open(first);
    open(second);
    expect(first.open).toBe(false);
    expect(second.open).toBe(true);
  });

  it('closes on an outside press and after running a menu button, but not when toggling a checkbox', () => {
    open(first);
    const check = document.querySelector<HTMLInputElement>('#check')!;
    check.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    check.click();
    expect(first.open).toBe(true);

    document.querySelector<HTMLButtonElement>('#action')!.click();
    expect(first.open).toBe(false);

    open(first);
    document.querySelector('#outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(first.open).toBe(false);
  });

  it('closes the focused menu with Escape and returns focus to its summary', () => {
    open(first);
    document.querySelector<HTMLButtonElement>('#action')!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(first.open).toBe(false);
    expect(document.activeElement).toBe(first.querySelector('summary'));

    // フォーカスがメニュー外にあるときのEscは、開いているメニューに触れない。
    open(second);
    document.querySelector<HTMLButtonElement>('#outside')!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(second.open).toBe(true);
  });

  it('stops managing menus after dispose', () => {
    dispose();
    open(first);
    open(second);
    expect(first.open).toBe(true);
  });
});

describe('dialog focus restoration', () => {
  it('falls back to the menu summary when the opener is hidden inside a closed menu', async () => {
    document.body.innerHTML = `
      <details class="toolbar-menu" open>
        <summary>Edit</summary>
        <div class="toolbar-popover"><button id="opener" type="button">Open</button></div>
      </details>
    `;
    const menu = document.querySelector('details')!;
    const opener = document.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();

    const overlay = createModalOverlay();
    const box = createDialogBox('Dialog');
    const { okBtn, cancelBtn } = addButtonRow(box);
    overlay.appendChild(box);
    const result = wireDialog(overlay, okBtn, cancelBtn, () => true);

    // メニューが閉じ、開いたボタンがフォーカスを受け取れなくなった状態を再現する。
    menu.open = false;
    vi.spyOn(opener, 'focus').mockImplementation(() => {});
    cancelBtn.click();
    await result;
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  });
});

describe('ToolController shortcuts', () => {
  function setup(): { controller: ToolController; view: { handler: ICadMouseHandler | null } } {
    document.body.innerHTML = TOOL_BUTTON_IDS.map((id) => `<button id="${id}" class="tool-btn"></button>`).join('');
    const view = {
      handler: null as ICadMouseHandler | null,
      clearPreview() {},
      renderPreview() {},
      setMeasurement() {},
      setOperationStatus() {},
    };
    const controller = new ToolController(view as unknown as CadView, vi.fn(), document);
    controller.connectToolbar();
    return { controller, view };
  }

  it('activates tools by their toolbar position and exposes the measure tool', () => {
    const { controller, view } = setup();
    expect(TOOL_BUTTON_IDS).toHaveLength(9);
    expect(controller.activeTool).toBe('btn-select');
    expect(view.handler).toBeInstanceOf(SelectionHandler);

    expect(controller.activateByIndex(9)).toBe(true);
    expect(controller.activeTool).toBe('btn-measure');
    expect(view.handler).toBeInstanceOf(MeasureHandler);
    expect(document.querySelector('#btn-measure')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#btn-select')!.getAttribute('aria-pressed')).toBe('false');
    // 計測はモデルを変更しないため、履歴ラベルは汎用のままにする。
    expect(controller.historyLabel()).toBe('history.cadEdit');

    expect(controller.activateByIndex(0)).toBe(false);
    expect(controller.activateByIndex(10)).toBe(false);
    expect(controller.activeTool).toBe('btn-measure');

    document.querySelector<HTMLButtonElement>('#btn-add-beam')!.click();
    expect(controller.historyLabel()).toBe('history.addBeam');
  });
});

describe('CoordinateEntryController', () => {
  function setup(anchor: Point3D | null = null): {
    clicks: Point3D[];
    elements: Record<'x' | 'y' | 'z' | 'distance' | 'angle', HTMLInputElement>;
    buttons: Record<'commit' | 'polarCommit', HTMLButtonElement>;
  } {
    document.body.innerHTML = `
      <input id="x" type="number" value="0" /><input id="y" type="number" value="0" />
      <input id="z" type="number" value="0" /><button id="commit"></button>
      <input id="distance" type="number" value="1000" /><input id="angle" type="number" value="0" />
      <button id="polar"></button>
    `;
    const clicks: Point3D[] = [];
    const cadView = {
      constraintAnchor: anchor,
      handler: { onClick: (_view: CadView, position: Point3D) => clicks.push(position) },
    } as unknown as CadView;
    const elements = {
      x: byId<HTMLInputElement>('x'),
      y: byId<HTMLInputElement>('y'),
      z: byId<HTMLInputElement>('z'),
      distance: byId<HTMLInputElement>('distance'),
      angle: byId<HTMLInputElement>('angle'),
    };
    const buttons = { commit: byId<HTMLButtonElement>('commit'), polarCommit: byId<HTMLButtonElement>('polar') };
    new CoordinateEntryController(cadView, doc, { ...elements, ...buttons }).connect();
    return { clicks, elements, buttons };
  }

  it('sends typed coordinates to the active tool by button or Enter', () => {
    const { clicks, elements, buttons } = setup();
    elements.x.value = '1200';
    elements.y.value = '-300';
    elements.z.value = '3000';
    buttons.commit.click();
    expect(clicks).toEqual([new Point3D(1200, -300, 3000)]);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    elements.y.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(clicks).toHaveLength(2);
  });

  it('flags the first non-numeric field instead of sending a point', () => {
    const { clicks, elements, buttons } = setup();
    elements.y.value = '';
    buttons.commit.click();
    expect(clicks).toEqual([]);
    expect(elements.y.validationMessage).toBe('有限の数値を入力してください');
    expect(document.activeElement).toBe(elements.y);

    elements.y.dispatchEvent(new Event('input'));
    expect(elements.y.validationMessage).toBe('');
  });

  it('requires a first point for distance and angle input', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { clicks, buttons } = setup(null);
    buttons.polarCommit.click();
    expect(alertSpy).toHaveBeenCalledWith('先に1点目を指定してください。');
    expect(clicks).toEqual([]);
  });

  it('converts distance and angle from the first point on the shown layer', () => {
    doc.addLayer(new Layer(3000, '2F'));
    doc.shownLayer = doc.layers[0];
    const { clicks, elements, buttons } = setup(new Point3D(1000, 1000, 0));
    elements.distance.value = '500';
    elements.angle.value = '450';
    buttons.polarCommit.click();

    expect(clicks).toHaveLength(1);
    expect(clicks[0].x).toBeCloseTo(1000);
    expect(clicks[0].y).toBeCloseTo(1500);
    expect(clicks[0].z).toBe(3000);
    expect(elements.angle.value).toBe('90');
    expect(elements.z.value).toBe('3000');

    elements.distance.value = '-1';
    buttons.polarCommit.click();
    expect(clicks).toHaveLength(1);
    expect(elements.distance.validationMessage).not.toBe('');
  });
});
