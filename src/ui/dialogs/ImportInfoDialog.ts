import type { ImportMetadata, ImportPropertyTable, ImportSummary, ImportWarning } from '../../data/ImportMetadata';
import { t } from '../../i18n';
import {
  addCloseButtonRow,
  createDialogBox,
  createModalOverlay,
  showModal,
} from './DialogUtil';

export async function showImportInfoDialog(metadata: ImportMetadata): Promise<boolean> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.importInfo'));
  box.classList.add('wide-dialog');

  const content = document.createElement('div');
  content.className = 'import-info-content';

  addSummary(content, metadata.summary);
  addIdMap(content, metadata.summary);
  addPropertyTable(content, t('import.materials'), metadata.materials);
  addPropertyTable(content, t('import.sections'), metadata.sections);
  addWarnings(content, metadata.summary.warnings);

  box.appendChild(content);
  const closeBtn = addCloseButtonRow(box);
  overlay.appendChild(box);
  return showModal(overlay, closeBtn);
}

function addSummary(container: HTMLElement, summary: ImportSummary): void {
  addSectionTitle(container, t('import.summary'));
  const rows = [
    [t('import.modelName'), summary.modelName || '-'],
    [t('import.sourceJson'), summary.sourceJson || '-'],
    [t('import.analysisProfile'), summary.analysisProfile || '-'],
    [t('import.units'), Object.entries(summary.units).map(([k, v]) => `${k}=${v}`).join(', ')],
    [t('import.counts'), `N:${summary.nodes} B:${summary.beams} C:${summary.pillars} F:${summary.floors} W:${summary.walls} BW:${summary.bearWalls} L:${summary.layers}`],
  ];
  container.appendChild(makeTable([t('import.item'), t('import.value')], rows));
}

function addIdMap(container: HTMLElement, summary: ImportSummary): void {
  addSectionTitle(container, t('import.sourceIdMap'));
  const rows = summary.sourceIdMap.map((row) => [
    row.kind,
    row.type,
    row.sourceId,
    String(row.appNumber),
    row.detail ?? '',
  ]);
  container.appendChild(makeTable([
    t('import.kind'),
    t('import.type'),
    t('import.sourceId'),
    t('import.appNumber'),
    t('import.detail'),
  ], rows));
}

function addPropertyTable(container: HTMLElement, title: string, table: ImportPropertyTable): void {
  addSectionTitle(container, title);
  const keys = collectPropertyKeys(table);
  const rows = Object.entries(table).map(([name, props]) => [
    name,
    ...keys.map((key) => formatValue(props[key])),
  ]);
  container.appendChild(makeTable([t('name'), ...keys], rows));
}

function addWarnings(container: HTMLElement, warnings: ImportWarning[]): void {
  addSectionTitle(container, t('import.warnings'));
  if (warnings.length === 0) {
    const p = document.createElement('p');
    p.textContent = t('import.noWarnings');
    container.appendChild(p);
    return;
  }
  const rows = warnings.map((warning) => [
    warning.code,
    warning.path ?? '',
    warning.message,
  ]);
  container.appendChild(makeTable([t('import.code'), t('import.path'), t('import.message')], rows));
}

function addSectionTitle(container: HTMLElement, title: string): void {
  const h4 = document.createElement('h4');
  h4.textContent = title;
  container.appendChild(h4);
}

function makeTable(headers: string[], rows: string[][]): HTMLTableElement {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach((header) => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function collectPropertyKeys(table: ImportPropertyTable): string[] {
  const keys = new Set<string>();
  Object.values(table).forEach((props) => {
    Object.keys(props).forEach((key) => keys.add(key));
  });
  return [...keys];
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
