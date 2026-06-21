import type { DocumentData } from './DocumentData';
import { Node } from './Node';
import { Beam } from './Beam';
import { Pillar } from './Pillar';
import { BearWall } from './BearWall';
import { Wall } from './Wall';
import { Floor } from './Floor';

/** 採番カテゴリ（Node / 部材 / 面要素ごとに 0 起番） */
export type NumberCategory = 'node' | 'member' | 'plane';

export interface TypeEntry {
  ctor: abstract new (...args: any[]) => DocumentData;
  category: NumberCategory;
}

/**
 * データ型の「整列順」と「採番カテゴリ」の単一定義（T-2）。
 * 整列順 = 配列の並び。採番は category ごとに 0 起番。
 * BearWall は Wall より前に置く（BearWall extends Plane であり Wall ではないため、
 * constructor 同定では順序非依存だが、整列順としての意味を明示する）。
 */
export const TYPE_REGISTRY: readonly TypeEntry[] = [
  { ctor: Node, category: 'node' },
  { ctor: Beam, category: 'member' },
  { ctor: Pillar, category: 'member' },
  { ctor: BearWall, category: 'plane' },
  { ctor: Wall, category: 'plane' },
  { ctor: Floor, category: 'plane' },
];

/** カテゴリ別の CAD ID オフセット */
export const CAD_ID_OFFSET: Record<NumberCategory, number> = {
  node: 0,
  member: 100000,
  plane: 200000,
};

/** data が属する整列順インデックス（未登録は末尾扱い） */
export function typeOrderIndex(data: DocumentData): number {
  const idx = TYPE_REGISTRY.findIndex((e) => data instanceof e.ctor);
  return idx >= 0 ? idx : TYPE_REGISTRY.length;
}

/** data の採番カテゴリ（未登録は null） */
export function categoryOf(data: DocumentData): NumberCategory | null {
  return TYPE_REGISTRY.find((e) => data instanceof e.ctor)?.category ?? null;
}
