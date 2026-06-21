import { Member } from '../../data/Member';
import { t } from '../../i18n';
import {
  createModalOverlay, createDialogBox, addFormRow, addNodeRow, addButtonRow,
  wireDialog,
} from './DialogUtil';

/** Member（梁/柱）編集ダイアログ */
export async function showMemberDialog(member: Member): Promise<boolean> {
  const overlay = createModalOverlay();
  const title = member.constructor.name === 'Beam' ? t('dialog.beamProps') : t('dialog.pillarProps');
  const box = createDialogBox(title);

  addNodeRow(box, 'NodeI', member.nodeI!);
  addNodeRow(box, 'NodeJ', member.nodeJ!);
  const inputSection = addFormRow(box, t('section'), 'text', member.section);

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  return wireDialog(overlay, okBtn, cancelBtn, () => {
    member.section = inputSection.value;
    return true;
  });
}
