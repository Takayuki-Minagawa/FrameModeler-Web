import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import type { Point3D } from '../../math/Point3D';
import { AddElementsCommand } from '../../commands/DocumentCommands';
import { planNodes } from './geometry';

/** 節点追加ハンドラ */
export class AddNodeHandler implements ICadMouseHandler {
  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const { additions } = planNodes([pos]);
    if (additions.length > 0) {
      try {
        Document.instance.execute(new AddElementsCommand(additions, '節点追加'));
      } catch (error) {
        alert((error as Error).message);
      }
    }
    view.renderElements();
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}
  onMouseMove(_view: CadView, _pos: Point3D): void {}
  draw(_view: CadView): void {}
}
