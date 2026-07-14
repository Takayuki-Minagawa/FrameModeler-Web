// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Constraint } from '../src/data/Constraint';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { setLocale } from '../src/i18n';
import { Point3D } from '../src/math/Point3D';
import { showConstraintDialog } from '../src/ui/dialogs/ConstraintDialog';
import { showMemberDialog } from '../src/ui/dialogs/MemberDialog';
import { showNodeDialog } from '../src/ui/dialogs/NodeDialog';
import { showSupportDialog } from '../src/ui/dialogs/SupportDialog';

beforeEach(() => {
  document.body.innerHTML = '<button id="opener">open</button>';
  Document.instance.init();
  setLocale('ja');
});

afterEach(() => {
  if (document.querySelector('.modal-overlay')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  Document.instance.init();
  document.body.innerHTML = '';
});

describe('structural property dialogs', () => {
  it('returns a validated six-DOF mass snapshot without mutating the Node', async () => {
    const node = new Node(new Point3D(10, 20, 30));
    const promise = showNodeDialog(node);

    const massEnabled = controlForLabel<HTMLInputElement>('質量を設定');
    massEnabled.checked = true;
    massEnabled.dispatchEvent(new Event('change', { bubbles: true }));

    const ux = controlForLabel<HTMLInputElement>('UX (並進)');
    ux.value = '-1';
    clickOk();

    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    expect(ux.getAttribute('aria-invalid')).toBe('true');
    expect(ux.getAttribute('aria-errormessage')).toBeTruthy();

    ['UX (並進)', 'UY (並進)', 'UZ (並進)', 'RX (回転)', 'RY (回転)', 'RZ (回転)'].forEach((label, index) => {
      setInputValue(controlForLabel<HTMLInputElement>(label), String(index + 1));
    });
    setInputValue(controlForLabel<HTMLInputElement>('並進質量の単位'), 'kg');
    setInputValue(controlForLabel<HTMLInputElement>('回転慣性の単位'), 'kg*mm^2');
    clickOk();

    await expect(promise).resolves.toEqual({
      pos: new Point3D(10, 20, 30),
      mass: {
        values: [1, 2, 3, 4, 5, 6],
        translationalUnit: 'kg',
        rotationalUnit: 'kg*mm^2',
      },
    });
    expect(node.mass).toBeNull();
  });

  it('validates positive Truss area and returns all unit-bearing properties', async () => {
    const truss = new Truss(new Node(new Point3D()), new Node(new Point3D(1000, 0, 0)));
    truss.section = 'T1';
    truss.area = 0;
    const promise = showMemberDialog(truss);

    const area = controlForLabel<HTMLInputElement>('断面積');
    clickOk();
    expect(area.getAttribute('aria-invalid')).toBe('true');

    setInputValue(controlForLabel<HTMLInputElement>('材料'), 'steel');
    setInputValue(area, '225');
    setInputValue(controlForLabel<HTMLInputElement>('断面積の単位'), 'mm^2');
    setInputValue(controlForLabel<HTMLInputElement>('ヤング係数（任意）'), '205000');
    setInputValue(controlForLabel<HTMLInputElement>('応力の単位'), 'N/mm^2');
    clickOk();

    await expect(promise).resolves.toEqual({
      kind: 'truss',
      section: 'T1',
      material: 'steel',
      area: 225,
      areaUnit: 'mm^2',
      elasticModulus: 205000,
      stressUnit: 'N/mm^2',
    });
    expect(truss.area).toBe(0);
    expect(truss.material).toBe('');
  });

  it('validates Spring orientation and returns enabled stiffness components in 6-DOF order', async () => {
    const spring = new Spring(new Node(new Point3D()), new Node(new Point3D()));
    spring.components = [{ dof: 'ux', stiffness: 10, unit: 'N/mm' }];
    spring.orientX = new Point3D(1, 0, 0);
    spring.orientY = new Point3D(0, 1, 0);
    const promise = showMemberDialog(spring);

    setInputValue(controlForLabel<HTMLInputElement>('UX 剛性'), '20');
    setInputValue(controlForLabel<HTMLInputElement>('Y.x'), '1');
    setInputValue(controlForLabel<HTMLInputElement>('Y.y'), '0');
    setInputValue(controlForLabel<HTMLInputElement>('Y.z'), '0');
    clickOk();

    const orientYz = controlForLabel<HTMLInputElement>('Y.z');
    expect(orientYz.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    setInputValue(controlForLabel<HTMLInputElement>('Y.x'), '0');
    setInputValue(controlForLabel<HTMLInputElement>('Y.y'), '1');
    clickOk();

    await expect(promise).resolves.toMatchObject({
      kind: 'spring',
      components: [{ dof: 'ux', stiffness: 20, unit: 'N/mm' }],
      orientX: new Point3D(1, 0, 0),
      orientY: new Point3D(0, 1, 0),
    });
    expect(spring.components[0].stiffness).toBe(10);
  });

  it('requires at least one restrained DOF and returns DOFs in the canonical order', async () => {
    const support = new Support(new Node(new Point3D()), ['ux']);
    const opener = document.getElementById('opener') as HTMLButtonElement;
    opener.focus();
    const promise = showSupportDialog(support);

    const ux = controlForLabel<HTMLInputElement>('UX (並進)');
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(dialog?.querySelector('h3')?.id);
    expect(document.activeElement).toBe(ux);
    ux.checked = false;
    ux.dispatchEvent(new Event('change', { bubbles: true }));
    clickOk();
    expect(ux.getAttribute('aria-invalid')).toBe('true');

    const rz = controlForLabel<HTMLInputElement>('RZ (回転)');
    rz.checked = true;
    rz.dispatchEvent(new Event('change', { bubbles: true }));
    clickOk();

    await expect(promise).resolves.toEqual({ fixedDofs: ['rz'] });
    expect(document.activeElement).toBe(opener);
    expect(support.fixedDofs).toEqual(['ux']);
  });

  it('validates non-zero Constraint coefficients and returns cloned master terms', async () => {
    const master = new Node(new Point3D());
    const slave = new Node(new Point3D(1000, 0, 0));
    const constraint = new Constraint(slave, 'ux', [{ node: master, dof: 'uy', coefficient: 1 }]);
    const promise = showConstraintDialog(constraint);

    const coefficient = controlForLabel<HTMLInputElement>('係数');
    setInputValue(coefficient, '0');
    clickOk();
    expect(coefficient.getAttribute('aria-invalid')).toBe('true');

    const slaveDof = controlForLabel<HTMLSelectElement>('従属自由度');
    slaveDof.value = 'uz';
    setInputValue(coefficient, '-2.5');
    clickOk();

    const result = await promise;
    expect(result).toEqual({
      slaveDof: 'uz',
      terms: [{ node: master, dof: 'uy', coefficient: -2.5 }],
    });
    expect(result?.terms[0]).not.toBe(constraint.terms[0]);
    expect(constraint.slaveDof).toBe('ux');
    expect(constraint.terms[0].coefficient).toBe(1);
  });
});

function controlForLabel<T extends HTMLInputElement | HTMLSelectElement>(text: string): T {
  const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === text);
  if (!label?.htmlFor) throw new Error(`Label not found: ${text}`);
  const control = document.getElementById(label.htmlFor);
  if (!control) throw new Error(`Control not found for: ${text}`);
  return control as T;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickOk(): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.modal-dialog button')].find(
    (candidate) => candidate.textContent === 'OK',
  );
  if (!button) throw new Error('OK button not found');
  button.click();
}
