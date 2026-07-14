import type { DocumentData, DocumentDataKind } from './DocumentData';
import { Node } from './Node';
import { Beam } from './Beam';
import { Pillar } from './Pillar';
import { Truss } from './Truss';
import { Spring } from './Spring';
import { BearWall } from './BearWall';
import { Wall } from './Wall';
import { Floor } from './Floor';
import { Support } from './Support';
import { Constraint } from './Constraint';

/** 採番カテゴリ（Node / 部材 / 面要素 / 拘束ごとに0起番） */
export type NumberCategory = 'node' | 'member' | 'plane' | 'constraint';

export interface TypeEntry {
  kind: DocumentDataKind;
  ctor: abstract new (...args: any[]) => DocumentData;
  category: NumberCategory;
}

/** 種別、整列順、採番カテゴリの単一定義。 */
export const TYPE_REGISTRY: readonly TypeEntry[] = [
  { kind: 'node', ctor: Node, category: 'node' },
  { kind: 'beam', ctor: Beam, category: 'member' },
  { kind: 'pillar', ctor: Pillar, category: 'member' },
  { kind: 'truss', ctor: Truss, category: 'member' },
  { kind: 'spring', ctor: Spring, category: 'member' },
  { kind: 'bearWall', ctor: BearWall, category: 'plane' },
  { kind: 'wall', ctor: Wall, category: 'plane' },
  { kind: 'floor', ctor: Floor, category: 'plane' },
  { kind: 'support', ctor: Support, category: 'constraint' },
  { kind: 'constraint', ctor: Constraint, category: 'constraint' },
];

/** codec/UIなどが型メタデータを再定義せず参照するためのlookup。 */
export function typeEntryForKind(kind: DocumentDataKind): TypeEntry {
  const entry = TYPE_REGISTRY.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`DocumentData kind '${kind}' is not registered`);
  return entry;
}

/** カテゴリ別の CAD ID オフセット。 */
export const CAD_ID_OFFSET: Record<NumberCategory, number> = {
  node: 0,
  member: 100000,
  plane: 200000,
  constraint: 300000,
};

export function registeredTypeOf(data: DocumentData): TypeEntry | null {
  return TYPE_REGISTRY.find((entry) => entry.kind === data.kind && data.constructor === entry.ctor) ?? null;
}

/** data が属する整列順インデックス（未登録は末尾扱い）。 */
export function typeOrderIndex(data: DocumentData): number {
  const entry = registeredTypeOf(data);
  return entry ? TYPE_REGISTRY.indexOf(entry) : TYPE_REGISTRY.length;
}

/** data の採番カテゴリ（未登録は null）。 */
export function categoryOf(data: DocumentData): NumberCategory | null {
  return registeredTypeOf(data)?.category ?? null;
}
