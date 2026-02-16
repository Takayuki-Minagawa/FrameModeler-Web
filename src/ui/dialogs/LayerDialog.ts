import { Layer } from '../Layer';
import {
  createModalOverlay, createDialogBox, addFormRow, addButtonRow,
  showDialog, closeDialog,
} from './DialogUtil';

/** レイヤー追加/編集ダイアログ */
export async function showLayerDialog(layer?: Layer): Promise<Layer | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(layer ? 'レイヤー編集' : 'レイヤー追加');

  const inputName = addFormRow(box, '名前', 'text', layer?.name ?? '新規レイヤー');
  const inputPosZ = addFormRow(box, 'Z位置', 'number', String(layer?.posZ ?? 0));

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  const { promise, resolve } = showDialog(overlay);

  let result: Layer | null = null;

  okBtn.addEventListener('click', () => {
    const posZ = parseFloat(inputPosZ.value);
    if (!isNaN(posZ)) {
      result = new Layer(posZ, inputName.value || '新規レイヤー');
      closeDialog(overlay);
      resolve(true);
    }
  });

  cancelBtn.addEventListener('click', () => {
    closeDialog(overlay);
    resolve(false);
  });

  await promise;
  return result;
}
