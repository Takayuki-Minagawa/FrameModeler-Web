import type { ICadMouseHandler, LayerAboveRequest } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import type { DocumentData, DocumentDataKind } from '../../data/DocumentData';
import { Point3D } from '../../math/Point3D';
import { reportModelError } from './errors';

/**
 * 2点クリックで要素を追加するハンドラの抽象基底（テンプレートメソッド）。
 *
 * 状態機械:
 *  1クリック目: acquireAnchor(pos) が anchor を返せば保持。null なら何もしない。
 *  2クリック目: commit(anchor, pos) で要素生成・重複チェック・showDialog を行い、
 *               その後 anchor をクリアして clearPreview。
 *  常に最後に view.render() を呼ぶ。
 *
 * アンカーの型 A はサブクラスで指定（Beam=Node, Floor/Wall/BearWall=Point3D）。
 */
export abstract class TwoClickAddHandler<A> implements ICadMouseHandler {
  protected anchor: A | null = null;
  protected showDialog: ((data: DocumentData) => void) | null = null;
  protected sectionProvider: ((kind: DocumentDataKind) => string) | null = null;
  protected layerAboveRequest: LayerAboveRequest | null = null;

  setDialogCallback(cb: (data: DocumentData) => void): void {
    this.showDialog = cb;
  }

  setDefaultSectionProvider(provider: (kind: DocumentDataKind) => string): void {
    this.sectionProvider = provider;
  }

  setLayerAboveRequest(request: LayerAboveRequest): void {
    this.layerAboveRequest = request;
  }

  /** 1クリック目: アンカーを取得（取得できなければ null を返し、1点目を保持しない） */
  protected abstract acquireAnchor(view: CadView, pos: Point3D): A | null;

  /** 2クリック目: 要素を生成・確定する（重複チェックや showDialog 呼び出しを含む） */
  protected abstract commit(view: CadView, anchor: A, pos: Point3D): void;

  /** 1点目保持中のプレビュー描画 */
  protected abstract drawPreview(view: CadView, anchor: A, pos: Point3D): void;

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    if (this.anchor === null) {
      const a = this.acquireAnchor(view, pos);
      if (a !== null) {
        this.anchor = a;
        view.setOperationStatus('firstPointSelected');
      }
      view.renderPreview();
      return;
    }

    const anchor = this.anchor;
    this.anchor = null;
    view.setOperationStatus(null);
    view.clearPreview();
    try {
      this.commit(view, anchor, pos);
    } catch (error) {
      reportModelError(error, view);
    } finally {
      view.renderElements();
      view.renderPreview();
    }
  }

  onDoubleClick(_view: CadView, _pos: Point3D, _event: MouseEvent): void {}

  onMouseMove(view: CadView, pos: Point3D): void {
    view.clearPreview();
    if (this.anchor !== null) {
      this.drawPreview(view, this.anchor, pos);
    }
    view.renderPreview();
  }

  draw(_view: CadView): void {}

  getConstraintAnchor(): Point3D | null {
    return this.anchor instanceof Point3D ? this.anchor.clone() : null;
  }

  /** 別ツールへ切替時: 途中の1点目を破棄しプレビューを消す */
  onDeactivate(view: CadView): void {
    this.anchor = null;
    view.setOperationStatus(null);
    view.clearPreview();
    view.renderPreview();
  }

  /** 新規要素の既定断面。直前に使った断面名が無ければ空文字。 */
  protected defaultSection(kind: DocumentDataKind): string {
    return this.sectionProvider?.(kind) ?? '';
  }

  /**
   * 上階レイヤーが無く直上位置を決められないとき、レイヤー作成を求めてから同じ点で操作をやり直す。
   * ロック中の階では作成できても確定できないため求めない。ツールが切り替わっていたり、
   * 依頼時と anchor の状態が変わっていれば、やり直さない。
   */
  protected retryAfterLayerAbove(view: CadView, pos: Point3D): void {
    if (!this.layerAboveRequest) return;
    if (Document.instance.shownLayer?.locked) {
      view.setOperationStatus('layerLocked');
      return;
    }
    const anchorAtRequest = this.anchor;
    void this.layerAboveRequest(pos.z).then((created) => {
      if (created && view.handler === this && this.anchor === anchorAtRequest) {
        this.onClick(view, pos, new MouseEvent('click'));
      }
    });
  }
}
