import type { Layer } from './Layer';
import type { Node } from './Node';
import type { DataState } from './DataState';

/** 永続化・検証・UI表示で共有する安定したモデル種別。constructor.nameには依存しない。 */
export type DocumentDataKind =
  'node' | 'beam' | 'pillar' | 'truss' | 'spring' | 'support' | 'constraint' | 'floor' | 'wall' | 'bearWall';

/** 削除可否の判定結果 */
export interface RemovableResult {
  removable: boolean;
  reason: string;
}

export abstract class DocumentData {
  number: number = 0;
  select: boolean = false;

  abstract readonly kind: DocumentDataKind;
  abstract get typeText(): string;

  isRemovable(): RemovableResult {
    return { removable: true, reason: '' };
  }

  /**
   * 型固有の可変フィールドを、後から復元・比較できる独立した値として返す。
   * 新しいフィールドを追加した型は、ここへ含めるだけでrollback・変更検出・等価判定に反映される。
   */
  abstract captureState(): DataState;

  /** captureState() の戻り値から可変フィールドを復元する。stateは再利用できるよう変更しない。 */
  abstract restoreState(state: DataState): void;

  /** この要素が参照するNode。参照を持たない型は空配列。 */
  get referencedNodes(): ReadonlyArray<Node> {
    return [];
  }

  /** 指定Nodeを参照しているか */
  isReferring(node: Node): boolean {
    return this.referencedNodes.includes(node);
  }

  /** 参照Nodeをmapに従って付け替える。mapに無いNodeはそのまま残す。 */
  remapNodes(_map: ReadonlyMap<Node, Node>): void {}

  /**
   * この要素が占めるZ範囲。レイヤー判定に使う（D-4）。
   * 範囲を持たない/不完全な要素は null を返す。サブクラスで上書き。
   */
  protected zRange(): { bottom: number; top: number } | null {
    return null;
  }

  /** 指定レイヤー上に存在するか（Z範囲がレイヤー高さを含むか） */
  existsOn(layer: Layer | null): boolean {
    if (!layer) return false;
    const r = this.zRange();
    if (!r) return false;
    return r.bottom <= layer.posZ && layer.posZ <= r.top;
  }

  /**
   * 同一型データ間の整列順。既定は順序なし(0)。
   * 型固有の整列が必要なサブクラス(Node/Beam/Pillar/Floor)がオーバーライドする。
   */
  compareTo(_other: DocumentData): number {
    return 0;
  }
}
