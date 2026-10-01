// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { summarizeModel } from '../src/data/ModelSummary';
import { Node } from '../src/data/Node';
import { setLocale } from '../src/i18n';
import { Point3D } from '../src/math/Point3D';
import { MAX_ARRAY_COPY_COUNT, showArrayCopyDialog } from '../src/ui/dialogs/ArrayCopyDialog';
import { showMergeNodesDialog } from '../src/ui/dialogs/MergeNodesDialog';
import { showModelSummaryDialog } from '../src/ui/dialogs/ModelSummaryDialog';

const doc = Document.instance;

beforeEach(() => {
  doc.init();
  document.body.innerHTML = '';
  localStorage.clear();
  setLocale('ja');
});

afterEach(() => {
  if (document.querySelector('.modal-overlay')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  document.body.innerHTML = '';
});

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.modal-dialog input')];
}

function fill(values: Array<string | number>): void {
  inputs().forEach((input, index) => {
    if (values[index] !== undefined) input.value = String(values[index]);
  });
}

function ok(): void {
  document.querySelector<HTMLButtonElement>('.modal-dialog button.primary')!.click();
}

function errorText(): string | undefined {
  return document.querySelector('.modal-dialog .field-error')?.textContent ?? undefined;
}

describe('showArrayCopyDialog', () => {
  it('returns the offset and count and starts from the previous input', async () => {
    const promise = showArrayCopyDialog({ offset: new Point3D(6000, 0, 0), count: 3 });
    expect(inputs().map((input) => input.value)).toEqual(['6000', '0', '0', '3']);
    expect(document.querySelector('.dialog-description')?.textContent).toContain('繰り返し複写');

    fill([0, -4000, 3000, 2]);
    ok();
    await expect(promise).resolves.toEqual({ offset: new Point3D(0, -4000, 3000), count: 2 });
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('rejects a zero offset, non-integer or out-of-range counts and non-numeric values', async () => {
    const promise = showArrayCopyDialog();
    expect(inputs().map((input) => input.value)).toEqual(['0', '0', '0', '1']);

    ok();
    expect(errorText()).toBe('ΔX・ΔY・ΔZのいずれかを0以外にしてください');

    fill([1000, 0, 0, 1.5]);
    ok();
    expect(errorText()).toBe(`1以上${MAX_ARRAY_COPY_COUNT}以下の整数を入力してください`);

    fill([1000, 0, 0, 0]);
    ok();
    expect(errorText()).toContain('整数を入力してください');

    fill([1000, 0, 0, MAX_ARRAY_COPY_COUNT + 1]);
    ok();
    expect(errorText()).toContain('整数を入力してください');

    fill([1000, '', 0, 1]);
    ok();
    expect(errorText()).toBe('有限の数値を入力してください');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    fill([1000, 0, 0, MAX_ARRAY_COPY_COUNT]);
    ok();
    await expect(promise).resolves.toEqual({ offset: new Point3D(1000, 0, 0), count: MAX_ARRAY_COPY_COUNT });
  });

  it('resolves null when cancelled', async () => {
    const promise = showArrayCopyDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(promise).resolves.toBeNull();
  });
});

describe('showMergeNodesDialog', () => {
  it('returns a non-negative tolerance and rejects negative values', async () => {
    const promise = showMergeNodesDialog(2.5);
    expect(inputs()[0].value).toBe('2.5');

    fill([-1]);
    ok();
    expect(errorText()).toBe('0以上の数値を入力してください');

    fill([0]);
    ok();
    await expect(promise).resolves.toBe(0);
  });

  it('resolves null when cancelled', async () => {
    const promise = showMergeNodesDialog();
    expect(inputs()[0].value).toBe('1');
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.modal-dialog button')].find(
      (button) => !button.classList.contains('primary'),
    )!;
    cancel.click();
    await expect(promise).resolves.toBeNull();
  });
});

describe('showModelSummaryDialog', () => {
  function tableTexts(): string[][][] {
    return [...document.querySelectorAll('.summary-content table')].map((table) =>
      [...table.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => cell.textContent ?? '')),
    );
  }

  it('shows counts, quantities in metres and the model extent, and exports on request', async () => {
    const n = [0, 1, 2, 3].map((index) => new Node(new Point3D(index % 2 ? 6000 : 0, index > 1 ? 4000 : 0, 0)));
    const beam = new Beam(n[0], n[1]);
    beam.section = '';
    doc.addMany([...n, beam, new Floor([n[0], n[1], n[3], n[2]])]);
    const onExport = vi.fn();

    const promise = showModelSummaryDialog(summarizeModel(doc), onExport);
    const [counts, members, planes, extent] = tableTexts();
    expect(counts[0]).toEqual(['種別', '数']);
    expect(counts).toContainEqual(['節点', '4']);
    expect(counts).toContainEqual(['拘束', '0']);
    expect(members.slice(1)).toEqual([
      ['梁', '（未設定）', '1', '6.000'],
      ['合計', '', '1', '6.000'],
    ]);
    expect(planes.slice(1)).toEqual([
      ['床', 'S1', '1', '24.000'],
      ['合計', '', '1', '24.000'],
    ]);
    expect(extent.at(-1)).toEqual(['寸法', '6000', '4000', '0']);

    const [exportButton, closeButton] = [...document.querySelectorAll<HTMLButtonElement>('.button-row button')];
    expect(document.activeElement).toBe(closeButton);
    exportButton.click();
    expect(onExport).toHaveBeenCalledOnce();
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    closeButton.click();
    await promise;
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('explains empty sections and disables the export for an empty model', async () => {
    setLocale('en');
    const promise = showModelSummaryDialog(summarizeModel(doc), vi.fn());
    expect(tableTexts()).toHaveLength(1);
    expect([...document.querySelectorAll('.summary-content p')].map((p) => p.textContent)).toEqual([
      'No elements.',
      'No elements.',
    ]);
    const exportButton = document.querySelector<HTMLButtonElement>('.button-row button')!;
    expect(exportButton.textContent).toBe('Save CSV');
    expect(exportButton.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });
});
