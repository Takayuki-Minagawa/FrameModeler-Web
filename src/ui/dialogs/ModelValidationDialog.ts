import type { ModelIssue } from '../../data/ModelInspector';
import { getLocale, subscribeLocaleChanged, t } from '../../i18n';
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
  box.appendChild(summary);

  const closeBtn = addCloseButtonRow(box);
  const issueViews: Array<{
    issue: ModelIssue;
    badge: HTMLSpanElement;
    message: HTMLSpanElement;
    selectButton?: HTMLButtonElement;
  }> = [];
  if (issues.length > 0) {
    const list = document.createElement('ul');
    list.className = 'validation-issue-list';
    for (const issue of issues) {
      const item = document.createElement('li');
      item.className = `validation-issue ${issue.severity}`;

      const badge = document.createElement('span');
      badge.className = 'validation-severity';
      item.appendChild(badge);

      const message = document.createElement('span');
      item.appendChild(message);

      let selectButton: HTMLButtonElement | undefined;
      if (issue.targets.length > 0) {
        selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.addEventListener('click', () => {
          onSelect(issue);
          closeBtn.click();
        });
        item.appendChild(selectButton);
      }
      issueViews.push({ issue, badge, message, selectButton });
      list.appendChild(item);
    }
    box.insertBefore(list, closeBtn.parentElement);
  }

  const renderLocale = (): void => {
    const title = box.querySelector('h3');
    if (title) title.textContent = t('dialog.modelValidation');
    summary.textContent =
      issues.length === 0
        ? t('validation.noIssues')
        : `${t('validation.errors')}: ${errors} / ${t('validation.warnings')}: ${warnings}`;
    closeBtn.textContent = t('close');
    for (const { issue, badge, message, selectButton } of issueViews) {
      badge.textContent = issue.severity === 'error' ? t('validation.error') : t('validation.warning');
      message.textContent = getLocale() === 'ja' ? issue.messageJa : issue.messageEn;
      if (selectButton) selectButton.textContent = t('validation.selectTargets');
    }
  };
  renderLocale();
  const unsubscribeLocale = subscribeLocaleChanged(renderLocale);
  overlay.appendChild(box);
  try {
    return await showModal(overlay, closeBtn);
  } finally {
    unsubscribeLocale();
  }
}
