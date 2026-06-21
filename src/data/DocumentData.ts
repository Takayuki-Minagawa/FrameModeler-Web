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
}
