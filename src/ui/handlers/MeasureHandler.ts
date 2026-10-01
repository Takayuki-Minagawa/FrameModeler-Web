import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Node } from '../../data/Node';
import type { Point3D } from '../../math/Point3D';

/**
 * 計測ハンドラ: 2点間の距離と ΔX / ΔY / ΔZ を表示する。モデルは変更しない。
 *
 * - 節点上をクリックした場合は、作業平面の高さに関係なくその節点の座標を使う。
 *   これにより3D・立面表示でも階をまたぐ距離を測れる。ロック中の階の節点も対象にする。
 * - それ以外は作業平面上のスナップ位置を使う。立面表示では作業平面が無いため節点だけを対象にする。
 * - 座標の数値入力は、近くに節点があっても入力値をそのまま使う。
 * - 2点目の確定後は結果を保持し、次のクリックで新しい計測を始める。
 */
export class MeasureHandler implements ICadMouseHandler {
  readonly supportsElevationPicking = true;
  private start: Point3D | null = null;
  private end: Point3D | null = null;

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const point = this.pick(view, pos);
    if (!point) return;

    if (this.start === null || this.end !== null) {
      this.start = point;
      this.end = null;
      view.setMeasurement(null);
      view.setOperationStatus('firstPointSelected');
    } else {
      this.end = point;
      view.setOperationStatus(null);
      view.setMeasurement({ from: this.start, to: this.end, final: true });
    }
    this.drawPreview(view, null);
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}

  onMouseMove(view: CadView, pos: Point3D): void {
    // 立面表示のマウス位置は作業平面へ投影できないため、仮表示はクリック確定後だけにする。
    const cursor = view.viewMode === 'elevation' ? null : pos;
    if (this.start !== null && this.end === null && cursor) {
      view.setMeasurement({ from: this.start, to: cursor, final: false });
    }
    this.drawPreview(view, cursor);
  }

  draw(_view: CadView): void {}

  getConstraintAnchor(): Point3D | null {
    return this.start !== null && this.end === null ? this.start.clone() : null;
  }

  onDeactivate(view: CadView): void {
    this.start = null;
    this.end = null;
    view.setMeasurement(null);
    view.setOperationStatus(null);
    view.clearPreview();
    view.renderPreview();
  }

  private pick(view: CadView, pos: Point3D): Point3D | null {
    if (!view.hasPointerPosition) return pos.clone();
    const hit = view.hitTest(pos, (data) => data instanceof Node, { includeLocked: true });
    if (hit instanceof Node) return hit.pos.clone();
    return view.viewMode === 'elevation' ? null : pos.clone();
  }

  private drawPreview(view: CadView, cursor: Point3D | null): void {
    view.clearPreview();
    if (this.start !== null) {
      const target = this.end ?? cursor;
      view.addPreviewPoint(this.start, view.previewColor);
      if (target) {
        view.addPreviewLine(this.start, target, view.previewColor);
        view.addPreviewPoint(target, view.previewColor);
      }
    }
    view.renderPreview();
  }
}
