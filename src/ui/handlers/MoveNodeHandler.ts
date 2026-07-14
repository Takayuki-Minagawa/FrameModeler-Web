import { SelectionHandler } from './SelectionHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { Point3D } from '../../math/Point3D';

/** 移動ハンドラ: SelectionHandlerを拡張し、選択ノードの移動を行う */
export class MoveNodeHandler extends SelectionHandler {
  private moving = false;
  private prevPos: Point3D = Point3D.Zero.clone();
  private originalPositions = new Map<Node, Point3D>();

  onClick(view: CadView, pos: Point3D, event: MouseEvent): void {
    if (this.moving) {
      this.applyPreviewDelta(pos);
      this.commitMove(view);
      return;
    }

    // 通常の選択処理
    super.onClick(view, pos, event);

    // クリックしたのがNodeか？
    const hit = view.hitTest(pos);
    if (hit instanceof Node && hit.select) {
      this.moving = true;
      this.prevPos = pos.clone();
      this.originalPositions = new Map(
        Document.instance.nodeList.filter((node) => node.select).map((node) => [node, node.pos.clone()] as const),
      );
    }
  }

  onMouseMove(view: CadView, pos: Point3D): void {
    if (this.moving) {
      if (this.applyPreviewDelta(pos)) view.renderElements();
    } else {
      super.onMouseMove(view, pos);
    }
  }

  onDeactivate(view: CadView): void {
    if (this.moving) this.restoreOriginalPositions();
    this.moving = false;
    this.originalPositions.clear();
    super.onDeactivate(view);
    view.renderElements();
  }

  /** drag中は表示用に直接座標を動かし、Document変更通知は確定時だけ行う。 */
  private applyPreviewDelta(pos: Point3D): boolean {
    const move = pos.sub(this.prevPos);
    if (move.length === 0) return false;
    for (const node of this.originalPositions.keys()) node.pos = node.pos.add(move);
    this.prevPos = pos.clone();
    return this.originalPositions.size > 0;
  }

  private commitMove(view: CadView): void {
    const finalPositions = new Map([...this.originalPositions.keys()].map((node) => [node, node.pos.clone()] as const));
    this.restoreOriginalPositions();

    try {
      Document.instance.update(() => {
        for (const [node, position] of finalPositions) node.pos = position.clone();
      });
    } catch (error) {
      alert((error as Error).message);
    } finally {
      this.moving = false;
      this.originalPositions.clear();
      view.renderElements();
    }
  }

  private restoreOriginalPositions(): void {
    for (const [node, position] of this.originalPositions) node.pos = position.clone();
  }
}
