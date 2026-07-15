import type { Layer } from './Layer';

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
