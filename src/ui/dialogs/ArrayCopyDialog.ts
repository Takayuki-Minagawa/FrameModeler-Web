import { Point3D } from '../../math/Point3D';
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

export interface ArrayCopyInput {
  /** 複写1回あたりの移動量 (mm)。 */
  offset: Point3D;
  /** 複写する回数。 */
  count: number;
}

/** 1回の操作で作れる複写数の上限。誤入力で巨大なモデルを作らないための歯止め。 */
export const MAX_ARRAY_COPY_COUNT = 200;

/** 配列複写のオフセットと個数を入力する。キャンセル時は null。 */
export async function showArrayCopyDialog(initial?: ArrayCopyInput): Promise<ArrayCopyInput | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.arrayCopy'));

  const description = document.createElement('p');
  description.className = 'dialog-description';
  description.textContent = t('arrayCopy.description');
  box.appendChild(description);

  const inputX = addFormRow(box, t('arrayCopy.dx'), 'number', String(initial?.offset.x ?? 0));
  const inputY = addFormRow(box, t('arrayCopy.dy'), 'number', String(initial?.offset.y ?? 0));
  const inputZ = addFormRow(box, t('arrayCopy.dz'), 'number', String(initial?.offset.z ?? 0));
  const inputCount = addFormRow(box, t('arrayCopy.count'), 'number', String(initial?.count ?? 1));
  inputCount.min = '1';
  inputCount.max = String(MAX_ARRAY_COPY_COUNT);
  inputCount.step = '1';

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: ArrayCopyInput | null = null;
  await wireDialog(overlay, okBtn, cancelBtn, () => {
    const x = readFiniteNumber(inputX);
    if (x === null) return false;
    const y = readFiniteNumber(inputY);
    if (y === null) return false;
    const z = readFiniteNumber(inputZ);
    if (z === null) return false;
    const count = readFiniteNumber(inputCount);
    if (count === null) return false;
    if (!Number.isInteger(count) || count < 1 || count > MAX_ARRAY_COPY_COUNT) {
      setFieldError(inputCount, t('validation.copyCount', { max: MAX_ARRAY_COPY_COUNT }));
      return false;
    }
    if (x === 0 && y === 0 && z === 0) {
      setFieldError(inputX, t('validation.offsetNonZero'));
      return false;
    }
    result = { offset: new Point3D(x, y, z), count };
    return true;
  });
  return result;
}
