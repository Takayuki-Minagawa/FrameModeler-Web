import { Node } from '../../data/Node';
import { Plane } from '../../data/Plane';
import { BearWall } from '../../data/BearWall';
import { t } from '../../i18n';
import { AddQuadPlaneHandler } from './AddWallHandler';

/** 耐力壁追加ハンドラ: 2クリックで下端2点→直上2点の四角形耐力壁を生成 */
export class AddBearWallHandler extends AddQuadPlaneHandler {
  protected createPlane(nodes: Node[]): Plane {
    return new BearWall(nodes);
  }

  protected duplicateMessage(): string {
    return t('msg.bearwallExists');
  }
}
