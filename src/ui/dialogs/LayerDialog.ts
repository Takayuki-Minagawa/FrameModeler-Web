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

export interface LayerDialogOptions {
  /** 'add' は新規レイヤー（渡した layer は既定値として使う）、'edit' は既存レイヤーの編集。 */
  mode?: 'add' | 'edit';
  /** ダイアログ見出し。省略時は mode から決める。 */
  title?: string;
  /** 見出しの下に表示する説明文。 */
  description?: string;
}

/** レイヤー追加/編集ダイアログ。add では layer を既定値として扱い、新しい ID のレイヤーを返す。 */
export async function showLayerDialog(layer?: Layer, options: LayerDialogOptions = {}): Promise<Layer | null> {
  const mode = options.mode ?? (layer ? 'edit' : 'add');
  const overlay = createModalOverlay();
  const box = createDialogBox(options.title ?? t(mode === 'edit' ? 'dialog.layerEdit' : 'dialog.layerAdd'));

  if (options.description) {
    const description = document.createElement('p');
    description.className = 'dialog-description';
    description.textContent = options.description;
    box.appendChild(description);
  }

  const inputName = addFormRow(box, t('name'), 'text', layer?.name ?? t('msg.defaultLayerName'));
  const inputPosZ = addFormRow(box, t('zPosition'), 'number', String(layer?.posZ ?? 0));

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: Layer | null = null;

  await wireDialog(overlay, okBtn, cancelBtn, () => {
    const posZ = readFiniteNumber(inputPosZ);
    if (posZ === null) return false;
    result = new Layer(posZ, inputName.value.trim() || t('msg.defaultLayerName'), {
      visible: layer?.visible,
      locked: layer?.locked,
    });
    return true;
  });

  return result;
}
