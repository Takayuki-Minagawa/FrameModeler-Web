import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { Point3D } from '../../math/Point3D';

/** 節点追加ハンドラ */
export class AddNodeHandler implements ICadMouseHandler {
  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const doc = Document.instance;
    let node = doc.getNodeAt(pos);
    if (!node) {
      node = new Node(pos);
      doc.add(node);
    }
    view.render();
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}
  onMouseMove(_view: CadView, _pos: Point3D): void {}
  draw(_view: CadView): void {}
}
