import type { ModelIssue } from '../../data/ModelInspector';
import { getLocale, t } from '../../i18n';
import { addCloseButtonRow, createDialogBox, createModalOverlay, showModal } from './DialogUtil';

export async function showModelValidationDialog(
  issues: ReadonlyArray<ModelIssue>,
  onSelect: (issue: ModelIssue) => void,
): Promise<boolean> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.modelValidation'));
  box.classList.add('wide-dialog');

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const summary = document.createElement('p');
  summary.className = errors > 0 ? 'validation-summary has-errors' : 'validation-summary';
  summary.setAttribute('role', errors > 0 ? 'alert' : 'status');
  summary.textContent =
    issues.length === 0
      ? t('validation.noIssues')
      : `${t('validation.errors')}: ${errors} / ${t('validation.warnings')}: ${warnings}`;
  box.appendChild(summary);

  const closeBtn = addCloseButtonRow(box);
  if (issues.length > 0) {
    const list = document.createElement('ul');
    list.className = 'validation-issue-list';
    for (const issue of issues) {
      const item = document.createElement('li');
      item.className = `validation-issue ${issue.severity}`;

      const badge = document.createElement('span');
      badge.className = 'validation-severity';
      badge.textContent = issue.severity === 'error' ? t('validation.error') : t('validation.warning');
      item.appendChild(badge);

      const message = document.createElement('span');
      message.textContent = getLocale() === 'ja' ? issue.messageJa : issue.messageEn;
      item.appendChild(message);

      if (issue.targets.length > 0) {
        const selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.textContent = t('validation.selectTargets');
        selectButton.addEventListener('click', () => {
          onSelect(issue);
          closeBtn.click();
        });
        item.appendChild(selectButton);
      }
      list.appendChild(item);
    }
    box.insertBefore(list, closeBtn.parentElement);
  }

  overlay.appendChild(box);
  return showModal(overlay, closeBtn);
}
