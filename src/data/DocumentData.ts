/** 削除可否の判定結果 */
export interface RemovableResult {
  removable: boolean;
  reason: string;
}

export abstract class DocumentData {
  number: number = 0;
  select: boolean = false;

  abstract get typeText(): string;

  isRemovable(): RemovableResult {
    return { removable: true, reason: '' };
  }

  /**
   * 同一型データ間の整列順。既定は順序なし(0)。
   * 型固有の整列が必要なサブクラス(Node/Beam/Pillar/Floor)がオーバーライドする。
   */
  compareTo(_other: DocumentData): number {
    return 0;
  }
}
