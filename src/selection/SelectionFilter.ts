import { Beam } from '../data/Beam';
import { BearWall } from '../data/BearWall';
import type { DocumentData } from '../data/DocumentData';
import { Floor } from '../data/Floor';
import { Node } from '../data/Node';
import { Pillar } from '../data/Pillar';
import { Wall } from '../data/Wall';

/** UI表現に依存しない、選択可能な要素種別。 */
export const SELECTION_KINDS = ['node', 'beam', 'pillar', 'floor', 'wall', 'bearWall'] as const;

export type SelectionKind = (typeof SELECTION_KINDS)[number];
export type SelectionTarget = 'all' | SelectionKind;

/**
 * 選択フィルタのスナップショット。
 *
 * `all` は個別種別がすべて有効かを表す派生値で、`all` の更新は全種別を
 * 一括でon/offする。個別値はそれぞれ独立して切り替えられる。
 */
export interface SelectionSettings {
  readonly all: boolean;
  readonly node: boolean;
  readonly beam: boolean;
  readonly pillar: boolean;
  readonly floor: boolean;
  readonly wall: boolean;
  readonly bearWall: boolean;
}

export const DEFAULT_SELECTION_SETTINGS: Readonly<SelectionSettings> = Object.freeze({
  all: true,
  node: true,
  beam: true,
  pillar: true,
  floor: true,
  wall: true,
  bearWall: true,
});

/**
 * DocumentDataの型だけを判定する選択フィルタ。
 * DOMやCadViewを参照しないため、UI・ショートカット・テストから同じ設定を共有できる。
 */
export class SelectionFilter {
  private current: Readonly<SelectionSettings>;

  constructor(initial: Partial<SelectionSettings> = {}) {
    this.current = mergeSettings(DEFAULT_SELECTION_SETTINGS, initial);
  }

  /** 外部から変更されない凍結済み設定スナップショット。 */
  get settings(): Readonly<SelectionSettings> {
    return this.current;
  }

  getSettings(): Readonly<SelectionSettings> {
    return this.current;
  }

  isEnabled(target: SelectionTarget): boolean {
    return this.current[target];
  }

  /** 部分更新。`all` と個別値を同時指定した場合は、個別値を優先する。 */
  setSettings(settings: Partial<SelectionSettings>): Readonly<SelectionSettings> {
    this.current = mergeSettings(this.current, settings);
    return this.current;
  }

  setEnabled(target: SelectionTarget, enabled: boolean): Readonly<SelectionSettings> {
    return this.setSettings({ [target]: enabled });
  }

  /** 指定した種別だけを有効にする。引数なしなら全種別を無効にする。 */
  enableOnly(...kinds: ReadonlyArray<SelectionKind>): Readonly<SelectionSettings> {
    const settings: Partial<Record<SelectionTarget, boolean>> = { all: false };
    for (const kind of kinds) settings[kind] = true;
    return this.setSettings(settings);
  }

  reset(): Readonly<SelectionSettings> {
    this.current = DEFAULT_SELECTION_SETTINGS;
    return this.current;
  }

  allows(data: DocumentData): boolean {
    // `all` は将来追加されるDocumentData型も既定で選択可能にする。
    if (this.current.all) return true;
    const kind = selectionKindOf(data);
    return kind !== null && this.current[kind];
  }
}

/** DocumentDataを個別フィルタ種別へ分類する。未対応の拡張型はnull。 */
export function selectionKindOf(data: DocumentData): SelectionKind | null {
  if (data instanceof Node) return 'node';
  if (data instanceof Beam) return 'beam';
  if (data instanceof Pillar) return 'pillar';
  if (data instanceof Floor) return 'floor';
  if (data instanceof Wall) return 'wall';
  if (data instanceof BearWall) return 'bearWall';
  return null;
}

function mergeSettings(
  base: Readonly<SelectionSettings>,
  patch: Partial<SelectionSettings>,
): Readonly<SelectionSettings> {
  const values: Record<SelectionKind, boolean> = {
    node: base.node,
    beam: base.beam,
    pillar: base.pillar,
    floor: base.floor,
    wall: base.wall,
    bearWall: base.bearWall,
  };

  if (patch.all !== undefined) {
    assertBoolean(patch.all, 'all');
    for (const kind of SELECTION_KINDS) values[kind] = patch.all;
  }

  for (const kind of SELECTION_KINDS) {
    const value = patch[kind];
    if (value === undefined) continue;
    assertBoolean(value, kind);
    values[kind] = value;
  }

  return Object.freeze({
    all: SELECTION_KINDS.every((kind) => values[kind]),
    ...values,
  });
}

function assertBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Selection setting '${name}' must be a boolean`);
}
