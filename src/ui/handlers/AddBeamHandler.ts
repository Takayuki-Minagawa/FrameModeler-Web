import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Beam } from '../../data/Beam';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import { TwoClickAddHandler } from './TwoClickAddHandler';
import { planNodes } from './geometry';

/** 梁追加ハンドラ: 2クリックでNodeI→NodeJを接続 */
export class AddBeamHandler extends TwoClickAddHandler<Point3D> {
  protected acquireAnchor(pos: Point3D): Point3D {
    return pos.clone();
  }

  protected commit(anchor: Point3D, pos: Point3D): void {
    const doc = Document.instance;
    const { nodes, additions } = planNodes([anchor, pos]);
    const [nodeI, nodeJ] = nodes;
    if (nodeI === nodeJ) return;

    if (doc.getMemberOf(nodeI, nodeJ)) {
      alert(t('msg.memberExists'));
    } else {
      const beam = new Beam(nodeI, nodeJ);
      doc.addMany([...additions, beam]);
      if (this.showDialog) this.showDialog(beam);
    }
  }

  protected drawPreview(view: CadView, anchor: Point3D, pos: Point3D): void {
    view.addPreviewLine(anchor, pos, view.previewColor);
    view.addPreviewPoint(anchor, view.previewColor);
  }
}
