import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { DocumentData } from '../../data/DocumentData';
import { Node } from '../../data/Node';
import { Beam } from '../../data/Beam';
import { Point3D } from '../../math/Point3D';

/** 梁追加ハンドラ: 2クリックでNodeI→NodeJを接続 */
export class AddBeamHandler implements ICadMouseHandler {
  private prevNode: Node | null = null;
  showDialog: ((data: DocumentData) => void) | null = null;

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const doc = Document.instance;
    let node = doc.getNodeAt(pos);
    if (!node) {
      node = new Node(pos);
      doc.add(node);
    }

    if (!this.prevNode) {
      this.prevNode = node;
    } else {
      if (doc.getMemberOf(this.prevNode, node)) {
        alert('既に接続されたメンバーが存在します');
      } else {
        const beam = new Beam(this.prevNode, node);
        doc.add(beam);
        if (this.showDialog) this.showDialog(beam);
      }
      this.prevNode = null;
      view.clearPreview();
    }
    view.render();
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}

  onMouseMove(view: CadView, pos: Point3D): void {
    view.clearPreview();
    if (this.prevNode) {
      view.addPreviewLine(this.prevNode.pos, pos, 0xff0000);
      view.addPreviewPoint(this.prevNode.pos, 0xff0000);
    }
    view.render();
  }

  draw(_view: CadView): void {}
}
