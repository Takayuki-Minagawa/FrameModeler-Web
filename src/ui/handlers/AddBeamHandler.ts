import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Beam } from '../../data/Beam';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import { TwoClickAddHandler } from './TwoClickAddHandler';
import { planNodes } from './geometry';
import { AddElementsCommand } from '../../commands/DocumentCommands';

/** 梁追加ハンドラ: 2クリックでNodeI→NodeJを接続 */
export class AddBeamHandler extends TwoClickAddHandler<Point3D> {
  protected acquireAnchor(_view: CadView, pos: Point3D): Point3D {
    return pos.clone();
  }

  protected commit(view: CadView, anchor: Point3D, pos: Point3D): void {
    const doc = Document.instance;
    const { nodes, additions } = planNodes([anchor, pos]);
    const [nodeI, nodeJ] = nodes;
    if (nodeI === nodeJ) {
      view.setOperationStatus('coincidentPoints');
      return;
    }

    if (doc.getMemberOf(nodeI, nodeJ)) {
      view.setOperationStatus('duplicateElement');
      alert(t('msg.memberExists'));
    } else {
      const beam = new Beam(nodeI, nodeJ);
      doc.execute(new AddElementsCommand([...additions, beam], '梁追加'));
      if (this.showDialog) this.showDialog(beam);
    }
  }

  protected drawPreview(view: CadView, anchor: Point3D, pos: Point3D): void {
    view.addPreviewLine(anchor, pos, view.previewColor);
    view.addPreviewPoint(anchor, view.previewColor);
  }
}
