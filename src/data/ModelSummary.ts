import type { Document } from './Document';
import type { DocumentDataKind } from './DocumentData';
import { Member } from './Member';
import { Plane } from './Plane';
import { TYPE_REGISTRY } from './typeRegistry';
import { Point3D } from '../math/Point3D';

/** 種別・断面ごとの数量。length / area はモデル単位（mm, mm²）。 */
export interface QuantityRow {
  kind: DocumentDataKind;
  section: string;
  count: number;
  /** 線材の延長合計 (mm)。面材では 0。 */
  length: number;
  /** 面材の面積合計 (mm²)。線材では 0。 */
  area: number;
}

export interface ModelSummary {
  /** TYPE_REGISTRY 順の種別ごとの要素数（0件の種別も含む）。 */
  counts: Array<{ kind: DocumentDataKind; count: number }>;
  memberRows: QuantityRow[];
  planeRows: QuantityRow[];
  totalMemberLength: number;
  totalPlaneArea: number;
  /** Nodeが1つも無い場合は null。 */
  bounds: { min: Point3D; max: Point3D } | null;
}

/** 多角形の面積。Newell法による法線ベクトルの大きさの半分で、傾いた面にも使える。 */
export function polygonArea(points: ReadonlyArray<Point3D>): number {
  if (points.length < 3) return 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    nx += (current.y - next.y) * (current.z + next.z);
    ny += (current.z - next.z) * (current.x + next.x);
    nz += (current.x - next.x) * (current.y + next.y);
  }
  return Math.hypot(nx, ny, nz) / 2;
}

/** 種別・断面ごとの本数、延長、面積を集計する。Documentは変更しない。 */
export function summarizeModel(document: Document): ModelSummary {
  const kindOrder = new Map(TYPE_REGISTRY.map((entry, index) => [entry.kind, index] as const));
  const countByKind = new Map<DocumentDataKind, number>(TYPE_REGISTRY.map((entry) => [entry.kind, 0] as const));
  const rows = new Map<string, QuantityRow>();
  const rowFor = (kind: DocumentDataKind, section: string): QuantityRow => {
    const key = `${kind}\u0000${section}`;
    let row = rows.get(key);
    if (!row) {
      row = { kind, section, count: 0, length: 0, area: 0 };
      rows.set(key, row);
    }
    return row;
  };

  for (const data of document.allDataList) {
    countByKind.set(data.kind, (countByKind.get(data.kind) ?? 0) + 1);
    if (data instanceof Member && data.ok) {
      const row = rowFor(data.kind, data.section.trim());
      row.count++;
      row.length += data.posJ.sub(data.posI).length;
    } else if (data instanceof Plane) {
      const row = rowFor(data.kind, data.section.trim());
      row.count++;
      row.area += polygonArea(data.nodeList.map((node) => node.pos));
    }
  }

  const sorted = [...rows.values()].sort(
    (a, b) =>
      kindOrder.get(a.kind)! - kindOrder.get(b.kind)! ||
      a.section.localeCompare(b.section, undefined, { numeric: true }),
  );
  const memberRows = sorted.filter((row) => isMemberKind(row.kind));
  const planeRows = sorted.filter((row) => !isMemberKind(row.kind));

  let bounds: ModelSummary['bounds'] = null;
  for (const node of document.nodeList) {
    bounds = bounds
      ? { min: Point3D.min(bounds.min, node.pos), max: Point3D.max(bounds.max, node.pos) }
      : { min: node.pos.clone(), max: node.pos.clone() };
  }

  return {
    counts: [...countByKind].map(([kind, count]) => ({ kind, count })),
    memberRows,
    planeRows,
    totalMemberLength: memberRows.reduce((sum, row) => sum + row.length, 0),
    totalPlaneArea: planeRows.reduce((sum, row) => sum + row.area, 0),
    bounds,
  };
}

function isMemberKind(kind: DocumentDataKind): boolean {
  return TYPE_REGISTRY.some((entry) => entry.kind === kind && entry.category === 'member');
}
