import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { Beam } from '../../data/Beam';
import type { Point3D } from '../../math/Point3D';
import { TwoClickAddHandler } from './TwoClickAddHandler';

/** 梁追加ハンドラ: 2クリックでNodeI→NodeJを接続 */
export class AddBeamHandler extends TwoClickAddHandler<Node> {
  protected acquireAnchor(pos: Point3D): Node {
    return Document.instance.getOrCreateNode(pos);
  }

  protected commit(anchor: Node, pos: Point3D): void {
    const doc = Document.instance;
    const node = doc.getOrCreateNode(pos);

    if (doc.getMemberOf(anchor, node)) {
      alert('既に接続されたメンバーが存在します');
    } else {
      const beam = new Beam(anchor, node);
      doc.add(beam);
      if (this.showDialog) this.showDialog(beam);
    }
  }

  protected drawPreview(view: CadView, anchor: Node, pos: Point3D): void {
    view.addPreviewLine(anchor.pos, pos, view.previewColor);
    view.addPreviewPoint(anchor.pos, view.previewColor);
  }
}
