import { getLocale, t } from '../../i18n';
import { messageLog, type MessageLog } from '../MessageLog';
import { createDialogBox, createModalOverlay, showModal } from './DialogUtil';

/** 直近のステータス通知・エラー・警告を一覧する。ステータスバーの通知は次の操作で消えるため、後から読み返せるようにする。 */
export function showMessageLogDialog(log: MessageLog = messageLog): Promise<boolean> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.messageLog'));
  box.classList.add('wide-dialog');

  const entries = log.recent;
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'dialog-description';
    empty.textContent = t('messageLog.empty');
    box.appendChild(empty);
  } else {
    const list = document.createElement('ol');
    list.className = 'message-log-list';
    list.setAttribute('aria-label', t('dialog.messageLog'));
    const locale = getLocale() === 'ja' ? 'ja-JP' : 'en-US';
    for (const entry of entries) {
      const item = document.createElement('li');
      item.className = `message-log-item level-${entry.level}`;
      const time = document.createElement('time');
      time.dateTime = new Date(entry.time).toISOString();
      time.textContent = new Date(entry.time).toLocaleTimeString(locale);
      const level = document.createElement('span');
      level.className = 'message-log-level';
      level.textContent = t(`messageLog.${entry.level}`);
      const text = document.createElement('span');
      text.className = 'message-log-text';
      text.textContent = entry.text;
      item.append(time, level, text);
      list.appendChild(item);
    }
    box.appendChild(list);
  }

  const row = document.createElement('div');
  row.className = 'button-row';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = t('messageLog.clear');
  clearBtn.disabled = entries.length === 0;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = t('close');
  closeBtn.className = 'primary';
  row.append(clearBtn, closeBtn);
  box.appendChild(row);
  overlay.appendChild(box);

  const promise = showModal(overlay, closeBtn);
  clearBtn.addEventListener('click', () => {
    log.clear();
    closeBtn.click();
  });
  return promise;
}
