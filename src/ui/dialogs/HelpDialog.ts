import { APP_VERSION } from '../../version';
import { t } from '../../i18n';
import { createModalOverlay, createDialogBox, closeDialog } from './DialogUtil';

export function showHelpDialog(): void {
  const overlay = createModalOverlay();
  const box = createDialogBox(`${t('help.title')} - Ver.${APP_VERSION}`);

  const content = document.createElement('div');
  content.className = 'help-content';

  // Tool operations
  const toolsH4 = document.createElement('h4');
  toolsH4.textContent = t('help.tools');
  content.appendChild(toolsH4);

  const toolRows = [
    ['help.select.name', 'help.select.desc'],
    ['help.move.name', 'help.move.desc'],
    ['help.addNode.name', 'help.addNode.desc'],
    ['help.addBeam.name', 'help.addBeam.desc'],
    ['help.addPillar.name', 'help.addPillar.desc'],
    ['help.addFloor.name', 'help.addFloor.desc'],
    ['help.addWall.name', 'help.addWall.desc'],
    ['help.addBearWall.name', 'help.addBearWall.desc'],
  ];
  content.appendChild(createTable(toolRows));

  // Camera controls
  const cameraH4 = document.createElement('h4');
  cameraH4.textContent = t('help.camera');
  content.appendChild(cameraH4);

  const cameraRows = [
    ['help.camera.rightDrag', 'help.camera.rightDrag.desc'],
    ['help.camera.middleDrag', 'help.camera.middleDrag.desc'],
    ['help.camera.wheel', 'help.camera.wheel.desc'],
  ];
  content.appendChild(createTable(cameraRows));

  // Data format
  const dataH4 = document.createElement('h4');
  dataH4.textContent = t('help.data');
  content.appendChild(dataH4);

  const dataP = document.createElement('p');
  dataP.textContent = t('help.data.desc');
  content.appendChild(dataP);

  box.appendChild(content);

  // Close button
  const btnRow = document.createElement('div');
  btnRow.className = 'button-row';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = t('close');
  closeBtn.className = 'primary';
  closeBtn.addEventListener('click', () => closeDialog(overlay));
  btnRow.appendChild(closeBtn);
  box.appendChild(btnRow);

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog(overlay);
  });
  document.body.appendChild(overlay);
}

function createTable(rows: string[][]): HTMLTableElement {
  const table = document.createElement('table');
  for (const [nameKey, descKey] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = t(nameKey);
    tr.appendChild(th);
    const td = document.createElement('td');
    td.textContent = t(descKey);
    tr.appendChild(td);
    table.appendChild(tr);
  }
  return table;
}
