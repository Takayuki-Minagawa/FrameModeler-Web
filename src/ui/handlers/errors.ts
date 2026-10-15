import { Document } from '../../data/Document';
import type { CadView } from '../CadView';
import { showMessageDialog } from '../dialogs/MessageDialog';
import { describeModelError } from '../ModelErrorMessage';

/**
 * 作図・移動の確定に失敗したとき、内部形式ではなく要素種別・番号で説明し、
 * 該当要素を選択してハイライトする。ブラウザ標準の alert は使わない。
 */
export function reportModelError(error: unknown, view: CadView, prefix?: (detail: string) => string): void {
  const doc = Document.instance;
  const { message, targets } = describeModelError(error, doc);
  if (targets.length > 0) {
    const highlighted = new Set(targets);
    for (const data of doc.allDataList) data.select = highlighted.has(data);
    view.renderSelection();
  }
  void showMessageDialog(prefix ? prefix(message) : message, { level: 'error' });
}
