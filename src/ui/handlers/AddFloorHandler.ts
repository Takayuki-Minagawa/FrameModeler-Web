import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Floor, FloorDirection } from '../../data/Floor';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import { TwoClickAddHandler } from './TwoClickAddHandler';
import { createRectPoints, planNodes } from './geometry';
import { AddElementsCommand, UpdatePropertiesCommand } from '../../commands/DocumentCommands';

/** 床追加ハンドラ: 2クリック矩形で床を生成 */
export class AddFloorHandler extends TwoClickAddHandler<Point3D> {
  protected acquireAnchor(_view: CadView, pos: Point3D): Point3D {
    return pos.clone();
  }

  protected commit(view: CadView, anchor: Point3D, pos: Point3D): void {
    const doc = Document.instance;
    if (pos.equals(anchor)) {
      view.setOperationStatus('coincidentPoints');
      return;
    }
    const points = createRectPoints(pos, anchor);
    const { nodes, additions } = planNodes(points);

    if (doc.getPlaneOf(nodes)) {
      view.setOperationStatus('duplicateElement');
      alert(t('msg.floorExists'));
    } else {
      const floor = new Floor(nodes);
      doc.execute(new AddElementsCommand([...additions, floor], '床追加'));
      if (this.showDialog) this.showDialog(floor);
    }
  }

  protected drawPreview(view: CadView, anchor: Point3D, pos: Point3D): void {
    view.addPreviewPolygon(createRectPoints(pos, anchor), view.previewColor);
  }

  /** 外部から明示的に呼ばれる場合も、直接mutationをDocument.updateで確定する。 */
  onDoubleClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const hit = view.hitTest(pos);
    if (!(hit instanceof Floor)) return;
    const direction = hit.direction === FloorDirection.X ? FloorDirection.Y : FloorDirection.X;
    Document.instance.execute(new UpdatePropertiesCommand('床方向変更', hit, (floor) => (floor.direction = direction)));
    view.renderSelection();
  }
}
