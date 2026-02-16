import { Member } from '../../data/Member';
import {
  createModalOverlay, createDialogBox, addFormRow, addButtonRow,
  showDialog, closeDialog,
} from './DialogUtil';

/** Member（梁/柱）編集ダイアログ */
export async function showMemberDialog(member: Member): Promise<boolean> {
  const overlay = createModalOverlay();
  const title = member.constructor.name === 'Beam' ? '梁プロパティ' : '柱プロパティ';
  const box = createDialogBox(title);

  addFormRow(box, 'NodeI', 'text', `${member.nodeI?.number} (${member.nodeI?.pos.toString()})`, true);
  addFormRow(box, 'NodeJ', 'text', `${member.nodeJ?.number} (${member.nodeJ?.pos.toString()})`, true);
  const inputSection = addFormRow(box, '断面', 'text', member.section);

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  const { promise, resolve } = showDialog(overlay);

  okBtn.addEventListener('click', () => {
    member.section = inputSection.value;
    closeDialog(overlay);
    resolve(true);
  });

  cancelBtn.addEventListener('click', () => {
    closeDialog(overlay);
    resolve(false);
  });

  return promise;
}
