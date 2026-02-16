import type { CadView } from '../CadView';
import type { Point3D } from '../../math/Point3D';

/** CadView上のマウス操作ハンドラ・インタフェース */
export interface ICadMouseHandler {
  onClick(view: CadView, pos: Point3D, event: MouseEvent): void;
  onDoubleClick(view: CadView, pos: Point3D, event: MouseEvent): void;
  onMouseMove(view: CadView, pos: Point3D): void;
  draw(view: CadView): void;
}
