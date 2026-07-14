import { Constraint, type ConstraintTerm } from '../../data/Constraint';
import type { Node } from '../../data/Node';
import { STRUCTURAL_DOFS, isStructuralDof, type StructuralDof } from '../../data/StructuralDof';
import { t } from '../../i18n';
import {
  addButtonRow,
  addFormRow,
  addNodeRow,
  addSelectRow,
  createDialogBox,
  createModalOverlay,
  readFiniteNumber,
  setFieldError,
  wireDialog,
} from './DialogUtil';
import { addStructuralFieldset } from './StructuralDialogUtil';

/** Commandへ渡すConstraintプロパティの完全スナップショット。 */
export interface ConstraintDialogResult {
  slaveDof: StructuralDof;
  terms: ConstraintTerm[];
}

interface ConstraintTermControls {
  node: Node;
  dof: HTMLSelectElement;
  coefficient: HTMLInputElement;
}

/** equalDOF線形拘束の従属自由度・主自由度・係数を編集する。節点接続とモデル自体は変更しない。 */
export async function showConstraintDialog(constraint: Constraint): Promise<ConstraintDialogResult | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.constraintProps'));
  box.classList.add('wide-dialog');

  addFormRow(box, t('structural.constraintKind'), 'text', constraint.constraintKind, true);
  if (constraint.slaveNode) addNodeRow(box, t('structural.slaveNode'), constraint.slaveNode);
  else addFormRow(box, t('structural.slaveNode'), 'text', '—', true);
  const slaveDof = addSelectRow(box, t('structural.slaveDof'), [...STRUCTURAL_DOFS], constraint.slaveDof);

  const termsFieldset = addStructuralFieldset(box, t('structural.masterTerms'));
  const termControls: ConstraintTermControls[] = constraint.terms.map((term, index) => {
    const fieldset = addStructuralFieldset(termsFieldset, `#${index + 1}`);
    addNodeRow(fieldset, t('structural.masterNode'), term.node);
    return {
      node: term.node,
      dof: addSelectRow(fieldset, t('structural.masterDof'), [...STRUCTURAL_DOFS], term.dof),
      coefficient: addFormRow(fieldset, t('structural.coefficient'), 'number', String(term.coefficient)),
    };
  });

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: ConstraintDialogResult | null = null;
  const confirmed = await wireDialog(overlay, okBtn, cancelBtn, () => {
    if (!isStructuralDof(slaveDof.value)) return false;
    const parsedSlaveDof = slaveDof.value;
    const terms: ConstraintTerm[] = [];
    const usedDofs = new Map<Node, Set<StructuralDof>>();

    for (const controls of termControls) {
      if (!isStructuralDof(controls.dof.value)) return false;
      const dof = controls.dof.value;
      const coefficient = readFiniteNumber(controls.coefficient);
      if (coefficient === null) return false;
      if (coefficient === 0) {
        setFieldError(controls.coefficient, t('validation.coefficientNonZero'));
        return false;
      }
      if (controls.node === constraint.slaveNode && dof === parsedSlaveDof) {
        setFieldError(controls.coefficient, t('validation.selfConstraint'));
        return false;
      }
      const nodeDofs = usedDofs.get(controls.node) ?? new Set<StructuralDof>();
      if (nodeDofs.has(dof)) {
        setFieldError(controls.coefficient, t('validation.duplicateConstraintTerm'));
        return false;
      }
      nodeDofs.add(dof);
      usedDofs.set(controls.node, nodeDofs);
      terms.push({ node: controls.node, dof, coefficient });
    }

    if (parsedSlaveDof !== constraint.slaveDof || !termsEqual(terms, constraint.terms)) {
      result = { slaveDof: parsedSlaveDof, terms };
    }
    return true;
  });
  return confirmed ? result : null;
}

function termsEqual(first: ReadonlyArray<ConstraintTerm>, second: ReadonlyArray<ConstraintTerm>): boolean {
  return (
    first.length === second.length &&
    first.every(
      (term, index) =>
        term.node === second[index].node &&
        term.dof === second[index].dof &&
        term.coefficient === second[index].coefficient,
    )
  );
}
