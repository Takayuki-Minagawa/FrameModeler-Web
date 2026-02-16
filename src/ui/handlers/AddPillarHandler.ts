import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { DocumentData } from '../../data/DocumentData';
import { Node } from '../../data/Node';
import { Pillar } from '../../data/Pillar';
import { Point3D } from '../../math/Point3D';

/** 柱追加ハンドラ: クリック位置の直上Nodeとの間に柱を生成 */
export class AddPillarHandler implements ICadMouseHandler {
  showDialog: ((data: DocumentData) => void) | null = null;

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const doc = Document.instance;

    // 直上のNodeを検索
    const top = doc.getNodeAbove(pos);
    if (!top) return;

    // 下側Node
    let bottom = doc.getNodeAt(pos);
    if (!bottom) {
      bottom = new Node(pos);
      doc.add(bottom);
    }

    if (doc.getMemberOf(top, bottom)) {
      alert('既に接続されたメンバーが存在します');
    } else {
      const pillar = new Pillar(bottom, top);
      doc.add(pillar);
      if (this.showDialog) this.showDialog(pillar);
    }
    view.render();
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}
  onMouseMove(_view: CadView, _pos: Point3D): void {}
  draw(_view: CadView): void {}
}
