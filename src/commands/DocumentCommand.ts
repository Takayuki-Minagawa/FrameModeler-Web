import type { Document } from '../data/Document';

/** Documentの変更を1つの検証・通知単位にまとめる。 */
export interface DocumentCommand<TResult = void> {
  readonly label: string;
  execute(document: Document): TResult;
}
