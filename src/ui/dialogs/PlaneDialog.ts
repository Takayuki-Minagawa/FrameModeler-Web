import { Plane } from '../../data/Plane';
import { Document } from '../../data/Document';
import { Floor, FloorDirection } from '../../data/Floor';
import { Wall } from '../../data/Wall';
import { BearWall } from '../../data/BearWall';
import { t } from '../../i18n';
import {
  createModalOverlay,
  createDialogBox,
  addFormRow,
  addNodeRow,
  addSelectRow,
  addButtonRow,
  readFiniteNumber,
  wireDialog,
} from './DialogUtil';

/** Plane（床/壁/耐力壁）編集ダイアログ */
export interface PlaneDialogChanges {
  section: string;
  weight?: number;
  direction?: FloorDirection;
}

export async function showPlaneDialog(plane: Plane): Promise<PlaneDialogChanges | null> {
  const overlay = createModalOverlay();

  let title = t('dialog.planeProps');
  if (plane instanceof Floor) title = t('dialog.floorProps');
  else if (plane instanceof Wall) title = t('dialog.wallProps');
  else if (plane instanceof BearWall) title = t('dialog.bearwallProps');

  const box = createDialogBox(title);

  // 節点情報（読み取り専用）
  for (let i = 0; i < plane.nodeCount; i++) {
    const n = plane.getNode(i);
    addNodeRow(box, `Node${i}`, n);
  }

  const inputSection = addFormRow(box, t('section'), 'text', plane.section);
  const sourceElements = Document.instance.getImportSourceElements(plane);
  if (sourceElements && sourceElements.length > 0) {
    const info = sourceElements[0];
    addFormRow(box, t('import.sourceId'), 'text', info.sourceId, true);
    addFormRow(box, t('import.sourceType'), 'text', info.sourceType, true);
    addFormRow(box, t('import.material'), 'text', info.material ?? '', true);
    if (info.elementTags && info.elementTags.length > 0) {
      addFormRow(box, t('import.elementTags'), 'text', info.elementTags.join(', '), true);
    }
  }

  // 床固有: 荷重、方向
  let inputWeight: HTMLInputElement | null = null;
  let selectDirection: HTMLSelectElement | null = null;
  if (plane instanceof Floor) {
    inputWeight = addFormRow(box, t('weight'), 'number', String(plane.weight));
    selectDirection = addSelectRow(
      box,
      t('direction'),
      [FloorDirection.X, FloorDirection.Y, FloorDirection.XY],
      plane.direction,
    );
  }

  // 壁固有: 荷重
  if (plane instanceof Wall) {
    inputWeight = addFormRow(box, t('weight'), 'number', String(plane.weight));
  }

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: PlaneDialogChanges | null = null;
  const confirmed = await wireDialog(overlay, okBtn, cancelBtn, () => {
    const nextWeight = inputWeight ? readFiniteNumber(inputWeight) : null;
    if (inputWeight && nextWeight === null) return false;

    const next: PlaneDialogChanges = { section: inputSection.value };
    if (plane instanceof Floor) {
      if (nextWeight !== null) next.weight = nextWeight;
      if (selectDirection) next.direction = selectDirection.value as FloorDirection;
    } else if (plane instanceof Wall && nextWeight !== null) {
      next.weight = nextWeight;
    }

    const changed =
      plane.section !== next.section ||
      (plane instanceof Floor && (plane.weight !== next.weight || plane.direction !== next.direction)) ||
      (plane instanceof Wall && plane.weight !== next.weight);
    if (changed) result = next;

    return true;
  });
  return confirmed ? result : null;
}
