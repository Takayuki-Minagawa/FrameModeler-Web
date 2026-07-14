import { Member } from '../../data/Member';
import { Document } from '../../data/Document';
import { t } from '../../i18n';
import { createModalOverlay, createDialogBox, addFormRow, addNodeRow, addButtonRow, wireDialog } from './DialogUtil';

/** Member（梁/柱）編集ダイアログ */
export async function showMemberDialog(member: Member): Promise<boolean> {
  const overlay = createModalOverlay();
  const title = member.constructor.name === 'Beam' ? t('dialog.beamProps') : t('dialog.pillarProps');
  const box = createDialogBox(title);

  addNodeRow(box, 'NodeI', member.nodeI!);
  addNodeRow(box, 'NodeJ', member.nodeJ!);
  const inputSection = addFormRow(box, t('section'), 'text', member.section);
  const sourceElements = Document.instance.getImportSourceElements(member);
  if (sourceElements && sourceElements.length > 0) {
    const info = sourceElements[0];
    addFormRow(box, t('import.sourceId'), 'text', info.sourceId, true);
    addFormRow(box, t('import.sourceType'), 'text', info.sourceType, true);
    addFormRow(box, t('import.material'), 'text', info.material ?? '', true);
    if (info.elementTags && info.elementTags.length > 0) {
      addFormRow(box, t('import.elementTags'), 'text', info.elementTags.join(', '), true);
    }
  }

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let changed = false;
  const confirmed = await wireDialog(overlay, okBtn, cancelBtn, () => {
    changed = member.section !== inputSection.value;
    if (changed) {
      member.section = inputSection.value;
    }
    return true;
  });
  return confirmed && changed;
}
