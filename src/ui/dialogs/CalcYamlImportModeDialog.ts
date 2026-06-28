import type { CalcYamlImportMode } from '../../io/CalcYamlDeserializer';
import { t } from '../../i18n';
import {
  createDialogBox,
  createModalOverlay,
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

  return new Promise((resolve) => {
    let closed = false;
    let close: (mode: CalcYamlImportMode | null) => void;
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(null);
    };
    close = (mode: CalcYamlImportMode | null): void => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(mode);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    cancelBtn.addEventListener('click', () => close(null));
    sourceBtn.addEventListener('click', () => close('source'));
    generatedBtn.addEventListener('click', () => close('generated'));
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
    sourceBtn.focus();
  });
}
