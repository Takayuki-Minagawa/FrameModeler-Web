import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { Floor, FloorDirection } from '../../data/Floor';
import { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';
import { TwoClickAddHandler } from './TwoClickAddHandler';
import { createRectPoints } from './geometry';

/** 床追加ハンドラ: 2クリック矩形で床を生成 */
export class AddFloorHandler extends TwoClickAddHandler<Point3D> {
  protected acquireAnchor(pos: Point3D): Point3D {
    return pos.clone();
  }

  protected commit(anchor: Point3D, pos: Point3D): void {
    const doc = Document.instance;
    if (!pos.equals(anchor)) {
      const points = createRectPoints(pos, anchor);
      const nodes = points.map((p) => doc.getOrCreateNode(p));

      if (doc.getPlaneOf(nodes)) {
        alert(t('msg.floorExists'));
      } else {
        const floor = new Floor(nodes);
        doc.add(floor);
        if (this.showDialog) this.showDialog(floor);
      }
    }
  }

  protected drawPreview(view: CadView, anchor: Point3D, pos: Point3D): void {
    view.addPreviewPolygon(createRectPoints(pos, anchor), view.previewColor);
  }

  onDoubleClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const hit = view.hitTest(pos);
    if (hit instanceof Floor) {
      hit.direction = hit.direction === FloorDirection.X ? FloorDirection.Y : FloorDirection.X;
      view.render();
    }
  }
}
