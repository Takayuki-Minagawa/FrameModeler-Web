import { Member } from '../../data/Member';
import { t } from '../../i18n';
import {
  createModalOverlay, createDialogBox, addFormRow, addButtonRow,
  wireDialog,
} from './DialogUtil';

/** Member（梁/柱）編集ダイアログ */
export async function showMemberDialog(member: Member): Promise<boolean> {
  const overlay = createModalOverlay();
  const title = member.constructor.name === 'Beam' ? t('dialog.beamProps') : t('dialog.pillarProps');
  const box = createDialogBox(title);

  addFormRow(box, 'NodeI', 'text', `${member.nodeI?.number} (${member.nodeI?.pos.toString()})`, true);
  addFormRow(box, 'NodeJ', 'text', `${member.nodeJ?.number} (${member.nodeJ?.pos.toString()})`, true);
  const inputSection = addFormRow(box, t('section'), 'text', member.section);

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  return wireDialog(overlay, okBtn, cancelBtn, () => {
    member.section = inputSection.value;
    return true;
  });
}
