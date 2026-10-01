import type { ModelSummary, QuantityRow } from '../../data/ModelSummary';
import { toMeters, toSquareMeters } from '../../io/CsvExporter';
import { kindLabel, t } from '../../i18n';
import { createDialogBox, createModalOverlay, showModal } from './DialogUtil';

/** 種別・断面ごとの数量を表示する。onExportCsv は「CSVを保存」ボタンで呼ばれる。 */
export function showModelSummaryDialog(summary: ModelSummary, onExportCsv: () => void): Promise<boolean> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.summary'));
  box.classList.add('wide-dialog');

  const content = document.createElement('div');
  content.className = 'import-info-content summary-content';

  addTitle(content, t('summary.counts'));
  content.appendChild(
    makeTable(
      [t('summary.kind'), t('summary.count')],
      summary.counts.map(({ kind, count }) => [kindLabel(kind), String(count)]),
      [1],
    ),
  );

  addTitle(content, t('summary.members'));
  content.appendChild(
    summary.memberRows.length > 0
      ? makeTable(
          [t('summary.kind'), t('section'), t('summary.count'), t('summary.totalLength')],
          [
            ...summary.memberRows.map((row) => quantityCells(row, formatQuantity(toMeters(row.length)))),
            totalCells(summary.memberRows, formatQuantity(toMeters(summary.totalMemberLength))),
          ],
          [2, 3],
        )
      : emptyNote(),
  );

  addTitle(content, t('summary.planes'));
  content.appendChild(
    summary.planeRows.length > 0
      ? makeTable(
          [t('summary.kind'), t('section'), t('summary.count'), t('summary.totalArea')],
          [
            ...summary.planeRows.map((row) => quantityCells(row, formatQuantity(toSquareMeters(row.area)))),
            totalCells(summary.planeRows, formatQuantity(toSquareMeters(summary.totalPlaneArea))),
          ],
          [2, 3],
        )
      : emptyNote(),
  );

  if (summary.bounds) {
    const { min, max } = summary.bounds;
    addTitle(content, t('summary.extent'));
    content.appendChild(
      makeTable(
        ['', 'X', 'Y', 'Z'],
        [
          [t('summary.min'), String(min.x), String(min.y), String(min.z)],
          [t('summary.max'), String(max.x), String(max.y), String(max.z)],
          [t('summary.size'), String(max.x - min.x), String(max.y - min.y), String(max.z - min.z)],
        ],
        [1, 2, 3],
      ),
    );
  }
  box.appendChild(content);

  const row = document.createElement('div');
  row.className = 'button-row';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = t('summary.exportCsv');
  exportBtn.disabled = summary.memberRows.length === 0 && summary.planeRows.length === 0;
  exportBtn.addEventListener('click', onExportCsv);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'primary';
  closeBtn.textContent = t('close');
  // 既定のフォーカスは閉じるボタンに置き、Enterで誤ってCSVを保存しないようにする。
  closeBtn.autofocus = true;
  row.append(exportBtn, closeBtn);
  box.appendChild(row);

  overlay.appendChild(box);
  return showModal(overlay, closeBtn);
}

function quantityCells(row: QuantityRow, quantity: string): string[] {
  return [kindLabel(row.kind), row.section || t('summary.unassigned'), String(row.count), quantity];
}

function totalCells(rows: ReadonlyArray<QuantityRow>, quantity: string): string[] {
  return [t('summary.total'), '', String(rows.reduce((sum, row) => sum + row.count, 0)), quantity];
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function addTitle(container: HTMLElement, text: string): void {
  const title = document.createElement('h4');
  title.textContent = text;
  container.appendChild(title);
}

function emptyNote(): HTMLParagraphElement {
  const note = document.createElement('p');
  note.textContent = t('summary.none');
  return note;
}

function makeTable(headers: string[], rows: string[][], numericColumns: number[]): HTMLTableElement {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  headers.forEach((text, index) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    if (numericColumns.includes(index)) th.classList.add('numeric');
    head.appendChild(th);
  });
  const body = table.createTBody();
  for (const cells of rows) {
    const tr = body.insertRow();
    cells.forEach((text, index) => {
      const td = tr.insertCell();
      td.textContent = text;
      if (numericColumns.includes(index)) td.classList.add('numeric');
    });
  }
  return table;
}
