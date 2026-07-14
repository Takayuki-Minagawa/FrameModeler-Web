import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import type { DocumentData } from '../../data/DocumentData';
import type { Point3D } from '../../math/Point3D';

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

  setDialogCallback(cb: (data: DocumentData) => void): void {
    this.showDialog = cb;
  }

  /** 1クリック目: アンカーを取得（取得できなければ null を返し、1点目を保持しない） */
  protected abstract acquireAnchor(pos: Point3D): A | null;

  /** 2クリック目: 要素を生成・確定する（重複チェックや showDialog 呼び出しを含む） */
  protected abstract commit(anchor: A, pos: Point3D): void;

  /** 1点目保持中のプレビュー描画 */
  protected abstract drawPreview(view: CadView, anchor: A, pos: Point3D): void;

  onClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    if (this.anchor === null) {
      const a = this.acquireAnchor(pos);
      if (a !== null) {
        this.anchor = a;
      }
      view.renderPreview();
      return;
    }

    const anchor = this.anchor;
    this.anchor = null;
    view.clearPreview();
    try {
      this.commit(anchor, pos);
    } catch (error) {
      alert((error as Error).message);
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

  /** 別ツールへ切替時: 途中の1点目を破棄しプレビューを消す */
  onDeactivate(view: CadView): void {
    this.anchor = null;
    view.clearPreview();
    view.renderPreview();
  }
}
