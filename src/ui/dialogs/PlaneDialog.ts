import { Plane } from '../../data/Plane';
import { Floor, FloorDirection } from '../../data/Floor';
import { Wall } from '../../data/Wall';
import { BearWall } from '../../data/BearWall';
import { t } from '../../i18n';
import {
  createModalOverlay, createDialogBox, addFormRow, addSelectRow, addButtonRow,
  showDialog, closeDialog,
} from './DialogUtil';

/** Plane（床/壁/耐力壁）編集ダイアログ */
export async function showPlaneDialog(plane: Plane): Promise<boolean> {
  const overlay = createModalOverlay();

  let title = t('dialog.planeProps');
  if (plane instanceof Floor) title = t('dialog.floorProps');
  else if (plane instanceof Wall) title = t('dialog.wallProps');
  else if (plane instanceof BearWall) title = t('dialog.bearwallProps');

  const box = createDialogBox(title);

  // 節点情報（読み取り専用）
  for (let i = 0; i < plane.nodeCount; i++) {
    const n = plane.getNode(i);
    addFormRow(box, `Node${i}`, 'text', `${n.number} (${n.pos.toString()})`, true);
  }

  const inputSection = addFormRow(box, t('section'), 'text', plane.section);

  // 床固有: 荷重、方向
  let inputWeight: HTMLInputElement | null = null;
  let selectDirection: HTMLSelectElement | null = null;
  if (plane instanceof Floor) {
    inputWeight = addFormRow(box, t('weight'), 'number', String(plane.weight));
    selectDirection = addSelectRow(box, t('direction'), ['X', 'Y', 'XY'], plane.direction);
  }

  // 壁固有: 荷重
  if (plane instanceof Wall) {
    inputWeight = addFormRow(box, t('weight'), 'number', String(plane.weight));
  }

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  const { promise, resolve } = showDialog(overlay);

  okBtn.addEventListener('click', () => {
    plane.section = inputSection.value;

    if (plane instanceof Floor) {
      if (inputWeight) plane.weight = parseFloat(inputWeight.value) || 0;
      if (selectDirection) {
        plane.direction = selectDirection.value as FloorDirection;
      }
    }

    if (plane instanceof Wall && inputWeight) {
      plane.weight = parseFloat(inputWeight.value) || 0;
    }

    closeDialog(overlay);
    resolve(true);
  });

  cancelBtn.addEventListener('click', () => {
    closeDialog(overlay);
    resolve(false);
  });

  return promise;
}
