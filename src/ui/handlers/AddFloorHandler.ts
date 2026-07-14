import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Floor, FloorDirection } from '../../data/Floor';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import { TwoClickAddHandler } from './TwoClickAddHandler';
import { createRectPoints, planNodes } from './geometry';

/** 床追加ハンドラ: 2クリック矩形で床を生成 */
export class AddFloorHandler extends TwoClickAddHandler<Point3D> {
  protected acquireAnchor(pos: Point3D): Point3D {
    return pos.clone();
  }

  protected commit(anchor: Point3D, pos: Point3D): void {
    const doc = Document.instance;
    if (!pos.equals(anchor)) {
      const points = createRectPoints(pos, anchor);
      const { nodes, additions } = planNodes(points);

      if (doc.getPlaneOf(nodes)) {
        alert(t('msg.floorExists'));
      } else {
        const floor = new Floor(nodes);
        doc.addMany([...additions, floor]);
        if (this.showDialog) this.showDialog(floor);
      }
    }
  }

  protected drawPreview(view: CadView, anchor: Point3D, pos: Point3D): void {
    view.addPreviewPolygon(createRectPoints(pos, anchor), view.previewColor);
  }

  /** 外部から明示的に呼ばれる場合も、直接mutationをDocument.updateで確定する。 */
  onDoubleClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const hit = view.hitTest(pos);
    if (!(hit instanceof Floor)) return;
    Document.instance.update(() => {
      hit.direction = hit.direction === FloorDirection.X ? FloorDirection.Y : FloorDirection.X;
    });
    view.renderSelection();
  }
}
