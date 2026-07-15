// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelIssue } from '../src/data/ModelInspector';
import { Node } from '../src/data/Node';
import { setLocale } from '../src/i18n';
import { Point3D } from '../src/math/Point3D';
import { showModelValidationDialog } from '../src/ui/dialogs/ModelValidationDialog';

const target = new Node(new Point3D());
const issues: ModelIssue[] = [
  {
    severity: 'error',
    code: 'MODEL_INVALID',
    path: 'nodes[0].mass.values[0]',
    messageJa: 'モデルに不正な値があります。',
    messageEn: 'The model contains an invalid value.',
    targets: [target],
  },
  {
    severity: 'warning',
    code: 'NO_SUPPORTS',
    messageJa: '支点がありません。',
    messageEn: 'The model has no supports.',
    targets: [],
  },
];

beforeEach(() => {
  document.body.innerHTML = '<main id="background"></main>';
  setLocale('ja');
});

afterEach(() => {
  document.body.replaceChildren();
  setLocale('ja');
});

describe('showModelValidationDialog', () => {
  it('renders every issue with its severity and selects a targeted issue', async () => {
    const onSelect = vi.fn();
    const result = showModelValidationDialog(issues, onSelect);

    expect(document.querySelector('.validation-summary')?.textContent).toBe('エラー: 1 / 警告: 1');
    const items = document.querySelectorAll<HTMLLIElement>('.validation-issue-list > li');
    expect(items).toHaveLength(2);
    expect(items[0].classList).toContain('error');
    expect(items[0].querySelector('.validation-severity')?.textContent).toBe('エラー');
    expect(items[0].textContent).toContain('モデルに不正な値があります。');
    expect(items[1].classList).toContain('warning');
    expect(items[1].querySelector('.validation-severity')?.textContent).toBe('警告');
    expect(items[1].textContent).toContain('支点がありません。');
    expect(document.querySelectorAll('.validation-issue button')).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('.validation-issue button')!.click();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(issues[0]);
    await expect(result).resolves.toBe(false);
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('updates summary, severity, messages and actions when locale changes while open', async () => {
    const result = showModelValidationDialog(issues, vi.fn());

    setLocale('en');

    expect(document.querySelector('.modal-dialog h3')?.textContent).toBe('Model Validation');
    expect(document.querySelector('.validation-summary')?.textContent).toBe('Errors: 1 / Warnings: 1');
    const items = document.querySelectorAll<HTMLLIElement>('.validation-issue-list > li');
    expect(items[0].querySelector('.validation-severity')?.textContent).toBe('Error');
    expect(items[0].textContent).toContain('The model contains an invalid value.');
    expect(items[0].querySelector('button')?.textContent).toBe('Select targets');
    expect(items[1].querySelector('.validation-severity')?.textContent).toBe('Warning');
    expect(items[1].textContent).toContain('The model has no supports.');
    expect(document.querySelector<HTMLButtonElement>('.button-row .primary')?.textContent).toBe('Close');

    document.querySelector<HTMLButtonElement>('.button-row .primary')!.click();
    await expect(result).resolves.toBe(false);
  });
});
