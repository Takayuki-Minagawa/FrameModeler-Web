import { Node } from '../../data/Node';
import { Document } from '../../data/Document';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import {
  createModalOverlay,
  createDialogBox,
  addFormRow,
  addButtonRow,
  readFiniteNumber,
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
    const x = readFiniteNumber(inputX);
    const y = readFiniteNumber(inputY);
    const z = readFiniteNumber(inputZ);
    if (x === null || y === null || z === null) return false;
    changed = node.pos.x !== x || node.pos.y !== y || node.pos.z !== z;
    if (changed) {
      node.pos = new Point3D(x, y, z);
    }
    return true;
  });
  return confirmed && changed;
}
