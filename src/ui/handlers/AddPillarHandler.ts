import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import type { DocumentData } from '../../data/DocumentData';
import { Pillar } from '../../data/Pillar';
import type { Point3D } from '../../math/Point3D';
import { t } from '../../i18n';

/** 柱追加ハンドラ: クリック位置の直上Nodeとの間に柱を生成 */
export class AddPillarHandler implements ICadMouseHandler {
  private showDialog: ((data: DocumentData) => void) | null = null;

  setDialogCallback(cb: (data: DocumentData) => void): void {
    this.showDialog = cb;
  }

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const doc = Document.instance;

    // 直上のNodeを検索
    const top = doc.getOrCreateNodeAbove(pos);
    if (!top) return;

    // 下側Node
    const bottom = doc.getOrCreateNode(pos);

    if (doc.getMemberOf(top, bottom)) {
      alert(t('msg.memberExists'));
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
