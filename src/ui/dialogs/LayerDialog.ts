import { Layer } from '../Layer';
import { t } from '../../i18n';
import {
  createModalOverlay,
  createDialogBox,
  addFormRow,
  addButtonRow,
  readFiniteNumber,
  wireDialog,
} from './DialogUtil';

/** レイヤー追加/編集ダイアログ */
export async function showLayerDialog(layer?: Layer): Promise<Layer | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(layer ? t('dialog.layerEdit') : t('dialog.layerAdd'));

  const inputName = addFormRow(box, t('name'), 'text', layer?.name ?? t('msg.defaultLayerName'));
  const inputPosZ = addFormRow(box, t('zPosition'), 'number', String(layer?.posZ ?? 0));

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: Layer | null = null;

  await wireDialog(overlay, okBtn, cancelBtn, () => {
    const posZ = readFiniteNumber(inputPosZ);
    if (posZ === null) return false;
    result = new Layer(posZ, inputName.value || t('msg.defaultLayerName'), {
      visible: layer?.visible,
      locked: layer?.locked,
    });
    return true;
  });

  return result;
}
