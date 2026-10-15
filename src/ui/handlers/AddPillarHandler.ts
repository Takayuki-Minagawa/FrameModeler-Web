import type { ICadMouseHandler, LayerAboveRequest } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import type { DocumentData, DocumentDataKind } from '../../data/DocumentData';
import { Pillar } from '../../data/Pillar';
import type { Point3D } from '../../math/Point3D';
import { planNodes } from './geometry';
import { AddElementsCommand } from '../../commands/DocumentCommands';
import { reportModelError } from './errors';

/**
 * 柱追加ハンドラ: クリック位置の直上（節点・部材・上階レイヤー高さ）との間に柱を生成する。
 * 上階レイヤーが無い場合はレイヤー作成を求め、作成後に同じ位置へ柱を立てる。
 */
export class AddPillarHandler implements ICadMouseHandler {
  private showDialog: ((data: DocumentData) => void) | null = null;
  private sectionProvider: ((kind: DocumentDataKind) => string) | null = null;
  private layerAboveRequest: LayerAboveRequest | null = null;

  setDialogCallback(cb: (data: DocumentData) => void): void {
    this.showDialog = cb;
  }

  setDefaultSectionProvider(provider: (kind: DocumentDataKind) => string): void {
    this.sectionProvider = provider;
  }

  setLayerAboveRequest(request: LayerAboveRequest): void {
    this.layerAboveRequest = request;
  }

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const doc = Document.instance;
    view.setOperationStatus(null);

    const above = doc.getPosAbove(pos);
    if (!above) {
      // ロック中の階では作成しても確定できないため、レイヤー作成は求めない。
      if (doc.shownLayer?.locked) {
        view.setOperationStatus('layerLocked');
        return;
      }
      view.setOperationStatus('noPointAbove');
      if (this.layerAboveRequest) {
        void this.layerAboveRequest(pos.z).then((created) => {
          if (created && view.handler === this) this.onClick(view, pos, _event);
        });
      }
      return;
    }
    const { nodes, additions } = planNodes([pos, above]);
    const [bottom, top] = nodes;

    if (doc.getMemberOf(top, bottom)) {
      view.setOperationStatus('duplicateElement');
    } else {
      try {
        const pillar = new Pillar(bottom, top);
        pillar.section = this.sectionProvider?.('pillar') ?? '';
        doc.execute(new AddElementsCommand([...additions, pillar], '柱追加'));
        if (this.showDialog) this.showDialog(pillar);
      } catch (error) {
        reportModelError(error, view);
      }
    }
    view.renderElements();
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}
  onMouseMove(_view: CadView, _pos: Point3D): void {}
  draw(_view: CadView): void {}

  onDeactivate(view: CadView): void {
    view.setOperationStatus(null);
  }
}
