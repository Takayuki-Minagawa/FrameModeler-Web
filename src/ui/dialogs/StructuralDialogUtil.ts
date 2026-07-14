import type { StructuralDof } from '../../data/StructuralDof';
import { t } from '../../i18n';
import { clearFieldError, readFiniteNumber, setFieldError } from './DialogUtil';

let structuralControlId = 0;

/** 構造情報を意味ごとにまとめる、legend付きのアクセシブルなfieldset。 */
export function addStructuralFieldset(container: HTMLElement, legendText: string): HTMLFieldSetElement {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'structural-fieldset';
  const legend = document.createElement('legend');
  legend.textContent = legendText;
  fieldset.appendChild(legend);
  container.appendChild(fieldset);
  return fieldset;
}

/** labelと関連付けたチェックボックス行。 */
export function addCheckboxRow(container: HTMLElement, labelText: string, checked: boolean): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'form-row structural-checkbox-row';

  const input = document.createElement('input');
  input.id = `structural-control-${++structuralControlId}`;
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => clearFieldError(input));

  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = labelText;

  row.append(input, label);
  container.appendChild(row);
  return input;
}

/** 必須文字列をtrimして読む。 */
export function readRequiredText(input: HTMLInputElement): string | null {
  const value = input.value.trim();
  if (value !== '') {
    clearFieldError(input);
    return value;
  }
  setFieldError(input, t('validation.requiredText'));
  return null;
}

/** 有限値を読み、追加の範囲条件も検証する。 */
export function readValidatedNumber(
  input: HTMLInputElement,
  predicate: (value: number) => boolean,
  rangeMessage: string,
): number | null {
  const value = readFiniteNumber(input);
  if (value === null) return null;
  if (predicate(value)) return value;
  setFieldError(input, rangeMessage);
  return null;
}

/** 空欄をnullとして許可し、それ以外は有限値と範囲条件を検証する。 */
export function readOptionalValidatedNumber(
  input: HTMLInputElement,
  predicate: (value: number) => boolean,
  rangeMessage: string,
): number | null | undefined {
  if (input.value.trim() === '') {
    clearFieldError(input);
    return null;
  }
  const value = readValidatedNumber(input, predicate, rangeMessage);
  return value === null ? undefined : value;
}

export function setCheckboxGroupError(input: HTMLInputElement, message: string): false {
  setFieldError(input, message);
  return false;
}

export function dofLabel(dof: StructuralDof): string {
  const suffix = dof.startsWith('u') ? t('structural.translation') : t('structural.rotation');
  return `${dof.toUpperCase()} (${suffix})`;
}

export function defaultStiffnessUnit(dof: StructuralDof): string {
  return dof.startsWith('u') ? 'N/mm' : 'N*mm/rad';
}

export function setInputsEnabled(enabled: boolean, inputs: ReadonlyArray<HTMLInputElement | HTMLSelectElement>): void {
  inputs.forEach((input) => {
    input.disabled = !enabled;
    if (!enabled && input instanceof HTMLInputElement) clearFieldError(input);
  });
}
