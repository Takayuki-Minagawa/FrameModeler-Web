import { Node } from '../../data/Node';
import { Document } from '../../data/Document';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import {
  createModalOverlay, createDialogBox, addFormRow, addButtonRow,
  wireDialog,
} from './DialogUtil';

/** Node編集ダイアログ */
export async function showNodeDialog(node: Node): Promise<boolean> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.nodeProps'));

  const inputX = addFormRow(box, 'X', 'number', String(node.pos.x));
  const inputY = addFormRow(box, 'Y', 'number', String(node.pos.y));
  const inputZ = addFormRow(box, 'Z', 'number', String(node.pos.z));
  const sourceNodes = Document.instance.getImportSourceNodes(node);
  if (sourceNodes && sourceNodes.length > 0) {
    addFormRow(box, t('import.sourceId'), 'text', sourceNodes.map((info) => info.sourceId).join(', '), true);
  }

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let changed = false;
  const confirmed = await wireDialog(overlay, okBtn, cancelBtn, () => {
    const x = parseFloat(inputX.value);
    const y = parseFloat(inputY.value);
    const z = parseFloat(inputZ.value);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return false;
    changed = node.pos.x !== x || node.pos.y !== y || node.pos.z !== z;
    if (changed) {
      node.pos = new Point3D(x, y, z);
    }
    return true;
  });
  return confirmed && changed;
}
