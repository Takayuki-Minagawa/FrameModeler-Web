import type { CadView } from '../CadView';
import type { Point3D } from '../../math/Point3D';
import type { DocumentData } from '../../data/DocumentData';

/** CadView上のマウス操作ハンドラ・インタフェース */
export interface ICadMouseHandler {
  /** native dblclickを受け取る選択系ツールだけtrueにする。 */
  readonly acceptsDoubleClick?: boolean;
  /** 正面・側面の閲覧用投影で、作業平面がなくてもscreen-space選択を許可する。 */
  readonly supportsElevationPicking?: boolean;
  onClick(view: CadView, pos: Point3D, event: MouseEvent): void;
  onDoubleClick(view: CadView, pos: Point3D, event: MouseEvent): void;
  onMouseMove(view: CadView, pos: Point3D): void;
  draw(view: CadView): void;
  /** 左ボタンドラッグ終了時（矩形選択の確定など）。実装は任意 */
  onEndDrag?(view: CadView, pos: Point3D, event: MouseEvent, dragDistancePx?: number): void;
  /** ダイアログ表示コールバックの注入。実装は任意 */
  setDialogCallback?(cb: (data: DocumentData) => void): void;
  /** 別ツールへ切り替わる直前に呼ばれる。途中状態の破棄などに使う。実装は任意 */
  onDeactivate?(view: CadView): void;
  /** 軸・直交拘束と距離/角度入力に使う現在の1点目。 */
  getConstraintAnchor?(): Point3D | null;
}
