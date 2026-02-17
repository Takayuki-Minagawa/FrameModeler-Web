import { Layer } from '../Layer';
import { t } from '../../i18n';
import {
  createModalOverlay, createDialogBox, addFormRow, addButtonRow,
  showDialog, closeDialog,
} from './DialogUtil';

/** レイヤー追加/編集ダイアログ */
export async function showLayerDialog(layer?: Layer): Promise<Layer | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(layer ? t('dialog.layerEdit') : t('dialog.layerAdd'));

  const inputName = addFormRow(box, t('name'), 'text', layer?.name ?? t('msg.defaultLayerName'));
  const inputPosZ = addFormRow(box, t('zPosition'), 'number', String(layer?.posZ ?? 0));

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  const { promise, resolve } = showDialog(overlay);

  let result: Layer | null = null;

  okBtn.addEventListener('click', () => {
    const posZ = parseFloat(inputPosZ.value);
    if (!isNaN(posZ)) {
      result = new Layer(posZ, inputName.value || t('msg.defaultLayerName'));
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
