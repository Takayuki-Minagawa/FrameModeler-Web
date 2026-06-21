import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { Plane } from '../../data/Plane';
import { Wall } from '../../data/Wall';
import { Point3D } from '../../math/Point3D';
import { TwoClickAddHandler } from './TwoClickAddHandler';
import { createQuadPoints } from './geometry';

/**
 * 壁系（壁/耐力壁）追加ハンドラの基底:
 * 2クリックで下端2点→直上2点の四角形を生成する。
 * 生成クラスと重複時メッセージのみサブクラスで差し替える。
 */
export abstract class AddQuadPlaneHandler extends TwoClickAddHandler<Point3D> {
  /** 生成する平面要素を返す */
  protected abstract createPlane(nodes: Node[]): Plane;
  /** 重複時の alert 文言 */
  protected abstract duplicateMessage(): string;

  protected acquireAnchor(pos: Point3D): Point3D | null {
    // 直上に何かあるか確認
    if (Document.instance.getPosAbove(pos)) {
      return pos.clone();
    }
    return null;
  }

  protected commit(anchor: Point3D, pos: Point3D): void {
    const doc = Document.instance;
    if (!pos.toPointXY().equals(anchor.toPointXY())) {
      const { points, aboveExists } = createQuadPoints(pos, anchor);

      if (aboveExists) {
        const nodes: Node[] = [];
        for (const p of points) {
          let n = doc.getNodeAt(p);
          if (!n) {
            n = new Node(p);
            doc.add(n);
          }
          nodes.push(n);
        }

        if (doc.getPlaneOf(nodes)) {
          alert(this.duplicateMessage());
        } else {
          const plane = this.createPlane(nodes);
          doc.add(plane);
          if (this.showDialog) this.showDialog(plane);
        }
      }
    }
  }

  protected drawPreview(view: CadView, anchor: Point3D, pos: Point3D): void {
    const { points } = createQuadPoints(pos, anchor);
    view.addPreviewPolygon(points, view.previewColor);
  }
}

/** 壁追加ハンドラ: 2クリックで下端2点→直上2点の四角形壁を生成 */
export class AddWallHandler extends AddQuadPlaneHandler {
  protected createPlane(nodes: Node[]): Plane {
    return new Wall(nodes);
  }

  protected duplicateMessage(): string {
    return '既に同一の壁が存在します';
  }
}
