import {
  CopyElementsCommand,
  DeleteSelectionCommand,
  MergeNodesCommand,
  RemoveOrphanNodesCommand,
} from '../commands/DocumentCommands';
import type { Document } from '../data/Document';
import type { DocumentData } from '../data/DocumentData';
import { repeatedOffsetTransforms } from '../data/ElementCopy';
import { Node } from '../data/Node';
import { findOrphanNodes } from '../data/NodeMerge';
import { kindLabel, t } from '../i18n';
import type { SelectionFilter, SelectionKind } from '../selection/SelectionFilter';
import type { CadView } from '../ui/CadView';
import { showArrayCopyDialog, type ArrayCopyInput } from '../ui/dialogs/ArrayCopyDialog';
import { showMergeNodesDialog } from '../ui/dialogs/MergeNodesDialog';
import type { TrackChange } from './PropertyEditController';

export interface EditControllerOptions {
  document: Document;
  cadView: CadView;
  selectionFilter: SelectionFilter;
  trackChange: TrackChange;
  cancelOperation: () => void;
  refreshDocument: (fit: boolean) => void;
  /** 操作結果の短い通知（ステータスバーなど）。 */
  notify: (message: string) => void;
  root?: globalThis.Document;
}

/** 選択操作と、選択要素に対する編集（削除・配列複写・モデル整理）をまとめる。 */
export class EditController {
  private readonly root: globalThis.Document;
  private lastArrayCopy: ArrayCopyInput | undefined;
  private lastMergeTolerance = 1;

  constructor(private readonly options: EditControllerOptions) {
    this.root = options.root ?? document;
  }

  connect(): void {
    const bind = (id: string, action: () => unknown): void => {
      this.root.getElementById(id)?.addEventListener('click', () => void action());
    };
    bind('btn-delete', () => this.deleteSelection());
    bind('btn-select-all', () => this.selectAll());
    bind('btn-invert-selection', () => this.invertSelection());
    bind('btn-array-copy', () => this.arrayCopy());
    bind('btn-merge-nodes', () => this.mergeNodes());
    bind('btn-remove-orphans', () => this.removeOrphanNodes());
    for (const input of this.selectionKindInputs()) {
      input.addEventListener('change', () => this.applySelectionFilter());
    }
  }

  /** 選択対象ポップオーバーの状態をフィルタへ反映し、対象外になった要素の選択を解除する。 */
  applySelectionFilter(): void {
    const { document: doc, selectionFilter, cadView } = this.options;
    const inputs = this.selectionKindInputs();
    const enabled = inputs
      .filter((input) => input.checked)
      .map((input) => input.dataset.selectionKind as SelectionKind);
    if (enabled.length === inputs.length) selectionFilter.reset();
    else selectionFilter.enableOnly(...enabled);
    for (const data of doc.allDataList) {
      if (data.select && !selectionFilter.allows(data)) data.select = false;
    }
    cadView.renderSelection();
  }

  /** 現在の表示で選択できる要素をすべて選択し、それ以外の選択を解除する。 */
  selectAll(): void {
    const selectable = new Set(this.selectableData());
    for (const data of this.options.document.allDataList) data.select = selectable.has(data);
    this.options.cadView.renderSelection();
  }

  /** 現在の表示で選択できる要素の選択状態を反転する。表示外の要素は変更しない。 */
  invertSelection(): void {
    for (const data of this.selectableData()) data.select = !data.select;
    this.options.cadView.renderSelection();
  }

  async deleteSelection(): Promise<void> {
    const { document: doc, trackChange, cancelOperation, refreshDocument } = this.options;
    cancelOperation();
    const selected = doc.allDataList.filter((data) => data.select);
    if (selected.length === 0) return;

    const selectedSet = new Set(selected);
    const blocked = selected
      .filter((data): data is Node => data instanceof Node)
      .flatMap((node) =>
        doc.allDataList
          .filter((data) => !selectedSet.has(data) && data.isReferring(node))
          .map((data) =>
            t('msg.nodeReferenced', { node: node.number, type: kindLabel(data.kind), number: data.number }),
          ),
      );
    if (blocked.length > 0) {
      alert(t('msg.deleteBlocked', { details: blocked.join('\n') }));
      return;
    }
    if (!confirm(t('msg.confirmDelete', { count: selected.length }))) return;

    try {
      await trackChange('history.deleteSelection', () => doc.execute(new DeleteSelectionCommand(selected)));
      refreshDocument(false);
    } catch (error) {
      alert(t('msg.deleteFailed', { message: (error as Error).message }));
    }
  }

  /** 選択要素を一定間隔で繰り返し複写する。 */
  async arrayCopy(): Promise<void> {
    const { document: doc, trackChange, cancelOperation, refreshDocument, notify } = this.options;
    cancelOperation();
    const selected = doc.allDataList.filter((data) => data.select);
    if (selected.length === 0) {
      alert(t('msg.nothingSelected'));
      return;
    }
    const input = await showArrayCopyDialog(this.lastArrayCopy);
    if (!input) return;
    this.lastArrayCopy = input;

    try {
      const additions = await trackChange('history.arrayCopy', () =>
        doc.execute(
          new CopyElementsCommand({
            nodes: selected.filter((data): data is Node => data instanceof Node),
            elements: selected.filter((data) => !(data instanceof Node)),
            transforms: repeatedOffsetTransforms(input.offset, input.count),
          }),
        ),
      );
      refreshDocument(false);
      const nodes = additions.filter((data) => data instanceof Node).length;
      notify(
        additions.length > 0
          ? t('msg.copyResult', { nodes, elements: additions.length - nodes })
          : t('msg.copyNothing'),
      );
    } catch (error) {
      alert(t('msg.copyFailed', { message: (error as Error).message }));
    }
  }

  /** 許容距離以内の節点を結合する。 */
  async mergeNodes(): Promise<void> {
    const { document: doc, trackChange, cancelOperation, refreshDocument, notify } = this.options;
    cancelOperation();
    const tolerance = await showMergeNodesDialog(this.lastMergeTolerance);
    if (tolerance === null) return;
    this.lastMergeTolerance = tolerance;

    try {
      const plan = await trackChange('history.mergeNodes', () => doc.execute(new MergeNodesCommand(tolerance)));
      refreshDocument(false);
      notify(
        plan.replacements.size > 0
          ? t('msg.mergeResult', { nodes: plan.replacements.size, elements: plan.redundantElements.length })
          : t('msg.mergeNothing'),
      );
    } catch (error) {
      alert(t('msg.mergeFailed', { message: (error as Error).message }));
    }
  }

  /** どの要素からも参照されていない節点を削除する。 */
  async removeOrphanNodes(): Promise<void> {
    const { document: doc, trackChange, cancelOperation, refreshDocument, notify } = this.options;
    cancelOperation();
    const count = findOrphanNodes(doc).length;
    if (count === 0) {
      notify(t('msg.noOrphans'));
      return;
    }
    if (!confirm(t('msg.confirmRemoveOrphans', { count }))) return;

    try {
      const removed = await trackChange('history.removeOrphanNodes', () => doc.execute(new RemoveOrphanNodesCommand()));
      refreshDocument(false);
      notify(t('msg.orphansRemoved', { count: removed.length }));
    } catch (error) {
      alert(t('msg.deleteFailed', { message: (error as Error).message }));
    }
  }

  /**
   * 現在の表示で選択できる要素。矩形選択と同じく、選択フィルタ・表示フィルタ・
   * レイヤーの表示とロックに従う。平面表示では現在の階にある要素に限る。
   */
  private selectableData(): DocumentData[] {
    const { document: doc, cadView, selectionFilter } = this.options;
    const layer = cadView.viewMode === 'plan' ? doc.shownLayer : null;
    return doc.allDataList.filter(
      (data) =>
        selectionFilter.allows(data) &&
        cadView.displayFilter.allows(data) &&
        doc.isDataVisible(data) &&
        !doc.isDataLocked(data) &&
        (!layer || data.existsOn(layer)),
    );
  }

  private selectionKindInputs(): HTMLInputElement[] {
    return [...this.root.querySelectorAll<HTMLInputElement>('[data-selection-kind]')];
  }
}
