import { t } from '../../i18n';
import {
  addButtonRow,
  addFormRow,
  createDialogBox,
  createModalOverlay,
  readFiniteNumber,
  setFieldError,
  wireDialog,
} from './DialogUtil';

/** 重複節点を結合する許容距離 (mm) を入力する。キャンセル時は null。 */
export async function showMergeNodesDialog(initialTolerance = 1): Promise<number | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.mergeNodes'));

  const description = document.createElement('p');
  description.className = 'dialog-description';
  description.textContent = t('mergeNodes.description');
  box.appendChild(description);

  const inputTolerance = addFormRow(box, t('mergeNodes.tolerance'), 'number', String(initialTolerance));
  inputTolerance.min = '0';

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: number | null = null;
  await wireDialog(overlay, okBtn, cancelBtn, () => {
    const tolerance = readFiniteNumber(inputTolerance);
    if (tolerance === null) return false;
    if (tolerance < 0) {
      setFieldError(inputTolerance, t('validation.nonNegativeNumber'));
      return false;
    }
    result = tolerance;
    return true;
  });
  return result;
}
