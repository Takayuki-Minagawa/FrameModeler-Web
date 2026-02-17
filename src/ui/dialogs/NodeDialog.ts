import { Node } from '../../data/Node';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import {
  createModalOverlay, createDialogBox, addFormRow, addButtonRow,
  showDialog, closeDialog,
} from './DialogUtil';

/** Node編集ダイアログ */
export async function showNodeDialog(node: Node): Promise<boolean> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.nodeProps'));

  const inputX = addFormRow(box, 'X', 'number', String(node.pos.x));
  const inputY = addFormRow(box, 'Y', 'number', String(node.pos.y));
  const inputZ = addFormRow(box, 'Z', 'number', String(node.pos.z));

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  const { promise, resolve } = showDialog(overlay);

  okBtn.addEventListener('click', () => {
    const x = parseFloat(inputX.value);
    const y = parseFloat(inputY.value);
    const z = parseFloat(inputZ.value);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
      node.pos = new Point3D(x, y, z);
      closeDialog(overlay);
      resolve(true);
    }
  });

  cancelBtn.addEventListener('click', () => {
    closeDialog(overlay);
    resolve(false);
  });

  return promise;
}
