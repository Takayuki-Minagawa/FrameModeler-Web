import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { DocumentData } from '../../data/DocumentData';
import { Node } from '../../data/Node';
import { BearWall } from '../../data/BearWall';
import { Point3D } from '../../math/Point3D';

/** 耐力壁追加ハンドラ: 2クリックで下端2点→直上2点の四角形耐力壁を生成 */
export class AddBearWallHandler implements ICadMouseHandler {
  private prevPoint: Point3D | null = null;
  showDialog: ((data: DocumentData) => void) | null = null;

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const doc = Document.instance;

    if (!this.prevPoint) {
      if (doc.getPosAbove(pos)) {
        this.prevPoint = pos.clone();
      }
    } else {
      if (!pos.toPointXY().equals(this.prevPoint.toPointXY())) {
        const { points, aboveExists } = createQuadPoints(pos, this.prevPoint);

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
            alert('既に同一の耐力壁が存在します');
          } else {
            const bear = new BearWall(nodes);
            doc.add(bear);
            if (this.showDialog) this.showDialog(bear);
          }
        }
      }
      this.prevPoint = null;
      view.clearPreview();
    }
    view.render();
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}

  onMouseMove(view: CadView, pos: Point3D): void {
    view.clearPreview();
    if (this.prevPoint) {
      const { points } = createQuadPoints(pos, this.prevPoint);
      for (let i = 0; i < points.length; i++) {
        const next = points[(i + 1) % points.length];
        view.addPreviewLine(points[i], next, 0xff0000);
      }
    }
    view.render();
  }

  draw(_view: CadView): void {}
}

function createQuadPoints(p: Point3D, q: Point3D): { points: Point3D[]; aboveExists: boolean } {
  const doc = Document.instance;
  const aboveP = doc.getPosAbove(p);
  const aboveQ = doc.getPosAbove(q);

  const aboveExists = aboveP !== null && aboveQ !== null;
  return {
    points: [
      p,
      q,
      aboveQ ?? q,
      aboveP ?? p,
    ],
    aboveExists,
  };
}
