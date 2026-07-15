import { Support } from '../../data/Support';
import { STRUCTURAL_DOFS, type StructuralDof } from '../../data/StructuralDof';
import { t } from '../../i18n';
import {
  addButtonRow,
  addFormRow,
  addNodeRow,
  clearFieldError,
  createDialogBox,
  createModalOverlay,
  wireDialog,
} from './DialogUtil';
import { addCheckboxRow, addStructuralFieldset, dofLabel, setCheckboxGroupError } from './StructuralDialogUtil';

/** Commandへ渡すSupportプロパティの完全スナップショット。 */
export interface SupportDialogResult {
  fixedDofs: StructuralDof[];
}

/** 6自由度支点条件を編集する。モデル自体は変更しない。 */
export async function showSupportDialog(support: Support): Promise<SupportDialogResult | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.supportProps'));

  if (support.node) addNodeRow(box, t('node'), support.node);
  else addFormRow(box, t('node'), 'text', '—', true);

  const fieldset = addStructuralFieldset(box, t('structural.fixedDofs'));
  const controls = STRUCTURAL_DOFS.map((dof) => ({
    dof,
    input: addCheckboxRow(fieldset, dofLabel(dof), support.fixedDofs.includes(dof)),
  }));
  controls.forEach(({ input }) => input.addEventListener('change', () => clearFieldError(controls[0].input)));

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: SupportDialogResult | null = null;
  const confirmed = await wireDialog(overlay, okBtn, cancelBtn, () => {
    const fixedDofs = controls.filter(({ input }) => input.checked).map(({ dof }) => dof);
    if (fixedDofs.length === 0) {
      setCheckboxGroupError(controls[0].input, t('validation.supportDofRequired'));
      return false;
    }
    if (!sameDofSet(fixedDofs, support.fixedDofs)) result = { fixedDofs };
    return true;
  });
  return confirmed ? result : null;
}

function sameDofSet(first: ReadonlyArray<StructuralDof>, second: ReadonlyArray<StructuralDof>): boolean {
  return first.length === second.length && first.every((dof) => second.includes(dof));
}
