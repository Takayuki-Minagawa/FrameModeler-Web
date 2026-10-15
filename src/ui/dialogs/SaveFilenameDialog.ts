import { t } from '../../i18n';
import { ensureJsonExtension } from '../../controllers/FileController';
import { addButtonRow, addFormRow, createDialogBox, createModalOverlay, setFieldError, wireDialog } from './DialogUtil';

/** ダウンロード保存するファイル名を確認する。キャンセル時は null。拡張子は .json に揃える。 */
export async function showSaveFilenameDialog(suggested: string): Promise<string | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.saveAs'));

  const description = document.createElement('p');
  description.className = 'dialog-description';
  description.textContent = t('saveAs.description');
  box.appendChild(description);

  const inputName = addFormRow(box, t('saveAs.filename'), 'text', suggested);
  const { okBtn, cancelBtn } = addButtonRow(box);
  okBtn.textContent = t('save');
  overlay.appendChild(box);

  let result: string | null = null;
  await wireDialog(overlay, okBtn, cancelBtn, () => {
    const name = inputName.value.trim();
    if (name === '' || /[\\/:*?"<>|]/.test(name)) {
      setFieldError(inputName, t('validation.filename'));
      return false;
    }
    result = ensureJsonExtension(name);
    return true;
  });
  return result;
}
