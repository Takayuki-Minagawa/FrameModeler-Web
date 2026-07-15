import { SelectionHandler } from './SelectionHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { Point3D } from '../../math/Point3D';
import { MoveNodesCommand } from '../../commands/DocumentCommands';

/** 移動ハンドラ: SelectionHandlerを拡張し、選択ノードの移動を行う */
export class MoveNodeHandler extends SelectionHandler {
  override readonly supportsElevationPicking = false;
  private moving = false;
  private anchorPos: Point3D = Point3D.Zero.clone();
  private originalPositions = new Map<Node, Point3D>();

  onClick(view: CadView, pos: Point3D, event: MouseEvent): void {
    if (this.moving) {
      this.commitMove(view, pos);
      return;
    }

    // 通常の選択処理
    super.onClick(view, pos, event);

    // クリックしたのがNodeか？
    const hit = view.hitTest(pos, (data) => this.allowsSelection(data));
    if (hit instanceof Node && hit.select) {
      this.moving = true;
      this.anchorPos = pos.clone();
      this.originalPositions = new Map(
        Document.instance.nodeList.filter((node) => node.select).map((node) => [node, node.pos.clone()] as const),
      );
    }
  }

  onMouseMove(view: CadView, pos: Point3D): void {
    if (this.moving) {
      this.drawMovePreview(view, pos);
    } else {
      super.onMouseMove(view, pos);
    }
  }

  onDeactivate(view: CadView): void {
    this.moving = false;
    this.originalPositions.clear();
    super.onDeactivate(view);
    view.renderPreview();
  }

  /** drag中はDocumentを触らず、移動元・移動先だけをpreview bufferへ描く。 */
  private drawMovePreview(view: CadView, pos: Point3D): void {
    const move = pos.sub(this.anchorPos);
    view.clearPreview();
    for (const original of this.originalPositions.values()) {
      const target = original.add(move);
      view.addPreviewLine(original, target, view.previewColor);
      view.addPreviewPoint(target, view.previewColor);
    }
    view.renderPreview();
  }

  private commitMove(view: CadView, pos: Point3D): void {
    const move = pos.sub(this.anchorPos);
    const finalPositions = new Map(
      [...this.originalPositions].map(([node, original]) => [node, original.add(move)] as const),
    );

    try {
      Document.instance.execute(new MoveNodesCommand(finalPositions));
    } catch (error) {
      alert((error as Error).message);
    } finally {
      this.moving = false;
      this.originalPositions.clear();
      view.clearPreview();
      view.renderElements();
      view.renderPreview();
    }
  }

  protected override allowsSelection(data: import('../../data/DocumentData').DocumentData): boolean {
    return data instanceof Node && super.allowsSelection(data);
  }
}
