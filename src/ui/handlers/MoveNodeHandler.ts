import { SelectionHandler } from './SelectionHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { Point3D } from '../../math/Point3D';

/** 移動ハンドラ: SelectionHandlerを拡張し、選択ノードの移動を行う */
export class MoveNodeHandler extends SelectionHandler {
  private moving = false;
  private prevPos: Point3D = Point3D.Zero.clone();

  onClick(view: CadView, pos: Point3D, event: MouseEvent): void {
    if (this.moving) {
      this.moving = false;
      view.render();
      return;
    }

    // 通常の選択処理
    super.onClick(view, pos, event);

    // クリックしたのがNodeか？
    const hit = view.hitTest(pos);
    if (hit instanceof Node && hit.select) {
      this.moving = true;
      this.prevPos = pos.clone();
    }
  }

  onMouseMove(view: CadView, pos: Point3D): void {
    if (this.moving) {
      const move = pos.sub(this.prevPos);
      for (const n of Document.instance.nodeList) {
        if (n.select) {
          n.pos = n.pos.add(move);
        }
      }
      this.prevPos = pos.clone();
      view.render();
    } else {
      super.onMouseMove(view, pos);
    }
  }
}
