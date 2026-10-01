import type { Document } from '../data/Document';
import { Member } from '../data/Member';
import type { ModelSummary, QuantityRow } from '../data/ModelSummary';
import { polygonArea } from '../data/ModelSummary';
import { Node } from '../data/Node';
import { Plane } from '../data/Plane';

export type CsvCell = string | number | null | undefined;

/** Excelが UTF-8 と認識するための BOM。ダウンロード時に先頭へ付ける。 */
export const CSV_BOM = '\uFEFF';

/**
 * RFC 4180 形式のCSV文字列を作る。
 * 文字列セルが = + - @ で始まる場合は、表計算ソフトで数式として実行されないよう ' を前置する。
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return rows.map((row) => row.map(formatCell).join(',')).join('\r\n') + '\r\n';
}

function formatCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  const text = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 節点一覧: number, x, y, z (mm)。列名は外部ツールで扱いやすいよう固定の英字とする。 */
export function nodesToCsv(document: Document): string {
  const rows: CsvCell[][] = [['number', 'x_mm', 'y_mm', 'z_mm']];
  for (const node of document.nodeList) rows.push([node.number, node.pos.x, node.pos.y, node.pos.z]);
  return toCsv(rows);
}

/** Node以外の全要素一覧。nodes は参照節点番号を空白区切りで並べる。 */
export function elementsToCsv(document: Document): string {
  const rows: CsvCell[][] = [['kind', 'number', 'section', 'nodes', 'length_mm', 'area_mm2']];
  for (const data of document.allDataList) {
    if (data instanceof Node) continue;
    const nodes = data.referencedNodes.map((node) => node.number).join(' ');
    if (data instanceof Member) {
      rows.push([
        data.kind,
        data.number,
        data.section,
        nodes,
        data.ok ? round(data.posJ.sub(data.posI).length) : null,
        null,
      ]);
    } else if (data instanceof Plane) {
      const area = polygonArea(data.nodeList.map((node) => node.pos));
      rows.push([data.kind, data.number, data.section, nodes, null, round(area)]);
    } else {
      rows.push([data.kind, data.number, '', nodes, null, null]);
    }
  }
  return toCsv(rows);
}

export interface SummaryCsvLabels {
  kind: string;
  section: string;
  count: string;
  lengthM: string;
  areaM2: string;
  total: string;
  unassigned: string;
  kindName: (kind: QuantityRow['kind']) => string;
}

/** 数量集計を、画面と同じ単位（m, m²）で1つの表として出力する。 */
export function summaryToCsv(summary: ModelSummary, labels: SummaryCsvLabels): string {
  const rows: CsvCell[][] = [[labels.kind, labels.section, labels.count, labels.lengthM, labels.areaM2]];
  for (const row of summary.memberRows) {
    rows.push([labels.kindName(row.kind), row.section || labels.unassigned, row.count, toMeters(row.length), null]);
  }
  for (const row of summary.planeRows) {
    rows.push([labels.kindName(row.kind), row.section || labels.unassigned, row.count, null, toSquareMeters(row.area)]);
  }
  rows.push([
    labels.total,
    '',
    [...summary.memberRows, ...summary.planeRows].reduce((sum, row) => sum + row.count, 0),
    toMeters(summary.totalMemberLength),
    toSquareMeters(summary.totalPlaneArea),
  ]);
  return toCsv(rows);
}

export function toMeters(lengthMm: number): number {
  return round(lengthMm / 1000);
}

export function toSquareMeters(areaMm2: number): number {
  return round(areaMm2 / 1_000_000);
}

/** 浮動小数の端数（0.1 + 0.2 など）を出力へ持ち込まないよう小数3桁へ丸める。 */
function round(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
