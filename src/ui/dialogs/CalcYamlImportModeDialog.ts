import type { CalcYamlImportMode } from '../../io/CalcYamlDeserializer';
import { t } from '../../i18n';
import {
  createDialogBox,
  createModalOverlay,
  showModalBase,
} from './DialogUtil';

export async function showCalcYamlImportModeDialog(): Promise<CalcYamlImportMode | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.calcYamlImportMode'));
  box.classList.add('wide-dialog');

  const content = document.createElement('div');
  content.className = 'import-mode-content';
  const description = document.createElement('p');
  description.textContent = t('importMode.description');
  content.appendChild(description);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'button-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = t('cancel');
  buttonRow.appendChild(cancelBtn);

  const generatedBtn = document.createElement('button');
  generatedBtn.textContent = t('importMode.generated');
  buttonRow.appendChild(generatedBtn);

  const sourceBtn = document.createElement('button');
  sourceBtn.textContent = t('importMode.source');
  sourceBtn.className = 'primary';
  buttonRow.appendChild(sourceBtn);

  box.appendChild(content);
  box.appendChild(buttonRow);
  overlay.appendChild(box);

  const { promise, dismiss } = showModalBase<CalcYamlImportMode | null>(overlay, null, () => {
    sourceBtn.focus();
  });
  cancelBtn.addEventListener('click', () => dismiss(null));
  sourceBtn.addEventListener('click', () => dismiss('source'));
  generatedBtn.addEventListener('click', () => dismiss('generated'));
  return promise;
}
