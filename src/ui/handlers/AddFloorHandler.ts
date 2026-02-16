import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { DocumentData } from '../../data/DocumentData';
import { Node } from '../../data/Node';
import { Floor, FloorDirection } from '../../data/Floor';
import { Point3D } from '../../math/Point3D';

/** 床追加ハンドラ: 2クリック矩形で床を生成 */
export class AddFloorHandler implements ICadMouseHandler {
  private prevPoint: Point3D | null = null;
  showDialog: ((data: DocumentData) => void) | null = null;

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const doc = Document.instance;

    if (!this.prevPoint) {
      this.prevPoint = pos.clone();
    } else {
      if (!pos.equals(this.prevPoint)) {
        const points = createRectPoints(pos, this.prevPoint);
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
          alert('既に同一の床が存在します');
        } else {
          const floor = new Floor(nodes);
          doc.add(floor);
          if (this.showDialog) this.showDialog(floor);
        }
      }
      this.prevPoint = null;
      view.clearPreview();
    }
    view.render();
  }

  onDoubleClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const hit = view.hitTest(pos);
    if (hit instanceof Floor) {
      hit.direction = hit.direction === FloorDirection.X ? FloorDirection.Y : FloorDirection.X;
      view.render();
    }
  }

  onMouseMove(view: CadView, pos: Point3D): void {
    view.clearPreview();
    if (this.prevPoint) {
      const points = createRectPoints(pos, this.prevPoint);
      for (let i = 0; i < points.length; i++) {
        const next = points[(i + 1) % points.length];
        view.addPreviewLine(points[i], next, 0xff0000);
      }
    }
    view.render();
  }

  draw(_view: CadView): void {}
}

function createRectPoints(p: Point3D, q: Point3D): Point3D[] {
  const min = Point3D.min(p, q);
  const max = Point3D.max(p, q);
  const z = (min.z + max.z) / 2;
  return [
    new Point3D(min.x, min.y, z),
    new Point3D(max.x, min.y, z),
    new Point3D(max.x, max.y, z),
    new Point3D(min.x, max.y, z),
  ];
}
