import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import type { DocumentDataKind } from '../../data/DocumentData';
import { Node } from '../../data/Node';
import { Plane } from '../../data/Plane';
import { Wall } from '../../data/Wall';
import { Point3D } from '../../math/Point3D';
import { TwoClickAddHandler } from './TwoClickAddHandler';
import { createQuadPoints, planNodes } from './geometry';
import { AddElementsCommand } from '../../commands/DocumentCommands';

/**
 * 壁系（壁/耐力壁）追加ハンドラの基底:
 * 2クリックで下端2点→直上2点の四角形を生成する。
 * 生成クラスと種別のみサブクラスで差し替える。
 */
export abstract class AddQuadPlaneHandler extends TwoClickAddHandler<Point3D> {
  /** 生成する平面要素を返す */
  protected abstract createPlane(nodes: Node[]): Plane;
  /** 既定断面の参照に使う種別 */
  protected abstract get planeKind(): DocumentDataKind;

  protected acquireAnchor(view: CadView, pos: Point3D): Point3D | null {
    // 直上に節点・部材・上階レイヤーのいずれかがあるか確認
    if (Document.instance.getPosAbove(pos)) {
      return pos.clone();
    }
    view.setOperationStatus('noPointAbove');
    this.retryAfterLayerAbove(view, pos);
    return null;
  }

  protected commit(view: CadView, anchor: Point3D, pos: Point3D): void {
    const doc = Document.instance;
    if (pos.toPointXY().equals(anchor.toPointXY())) {
      view.setOperationStatus('coincidentPoints');
      return;
    }
    const { points, aboveExists } = createQuadPoints(pos, anchor);

    if (!aboveExists) {
      view.setOperationStatus('noPointAbove');
      return;
    }
    const { nodes, additions } = planNodes(points);

    if (doc.getPlaneOf(nodes)) {
      view.setOperationStatus('duplicateElement');
    } else {
      const plane = this.createPlane(nodes);
      plane.section = this.defaultSection(this.planeKind);
      doc.execute(new AddElementsCommand([...additions, plane], '壁要素追加'));
      if (this.showDialog) this.showDialog(plane);
    }
  }

  protected drawPreview(view: CadView, anchor: Point3D, pos: Point3D): void {
    const { points } = createQuadPoints(pos, anchor);
    view.addPreviewPolygon(points, view.previewColor);
  }
}

/** 壁追加ハンドラ: 2クリックで下端2点→直上2点の四角形壁を生成 */
export class AddWallHandler extends AddQuadPlaneHandler {
  protected createPlane(nodes: Node[]): Plane {
    return new Wall(nodes);
  }

  protected get planeKind(): DocumentDataKind {
    return 'wall';
  }
}
