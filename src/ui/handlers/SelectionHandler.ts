import type { ICadMouseHandler } from './ICadMouseHandler';
import type { CadView } from '../CadView';
import { Document } from '../../data/Document';
import { DocumentData } from '../../data/DocumentData';
import { Node } from '../../data/Node';
import { Member } from '../../data/Member';
import { Plane } from '../../data/Plane';
import { Point3D } from '../../math/Point3D';

/** 選択ハンドラ: クリック選択、矩形選択、ダブルクリックでダイアログ表示 */
export class SelectionHandler implements ICadMouseHandler {
  private dragStartWorld: Point3D | null = null;
  protected showDialog: ((data: DocumentData) => void) | null = null;

  setDialogCallback(cb: (data: DocumentData) => void): void {
    this.showDialog = cb;
  }

  onClick(view: CadView, pos: Point3D, event: MouseEvent): void {
    const doc = Document.instance;
    const shift = event.shiftKey;
    const ctrl = event.ctrlKey;
    const hit = view.hitTest(pos);

    // Shift/Ctrlなしで空クリック or 非選択要素クリック → 全解除
    if (!shift && !ctrl && (!hit || !hit.select)) {
      for (const d of doc.allDataList) d.select = false;
    }

    if (hit) {
      if (ctrl) {
        hit.select = !hit.select;
      } else {
        hit.select = true;
      }
    }

    // 空クリック → 矩形選択開始
    this.dragStartWorld = hit ? null : pos.clone();

    view.render();
  }

  onDoubleClick(view: CadView, pos: Point3D, _event: MouseEvent): void {
    const hit = view.hitTest(pos);
    if (hit && this.showDialog) {
      this.showDialog(hit);
    }
  }

  onMouseMove(view: CadView, pos: Point3D): void {
    if (this.dragStartWorld) {
      // 矩形プレビュー
      view.clearPreview();
      const p = this.dragStartWorld;
      const q = pos;
      const z = p.z;
      const minX = Math.min(p.x, q.x);
      const maxX = Math.max(p.x, q.x);
      const minY = Math.min(p.y, q.y);
      const maxY = Math.max(p.y, q.y);
      view.addPreviewLine(new Point3D(minX, minY, z), new Point3D(maxX, minY, z), 0x0000ff);
      view.addPreviewLine(new Point3D(maxX, minY, z), new Point3D(maxX, maxY, z), 0x0000ff);
      view.addPreviewLine(new Point3D(maxX, maxY, z), new Point3D(minX, maxY, z), 0x0000ff);
      view.addPreviewLine(new Point3D(minX, maxY, z), new Point3D(minX, minY, z), 0x0000ff);
      view.render();
    }
  }

  draw(_view: CadView): void {}

  /** 左ボタンリリース時の矩形選択確定（CadViewから呼ばれる） */
  onEndDrag(view: CadView, pos: Point3D, event: MouseEvent): void {
    if (!this.dragStartWorld) return;

    const p = this.dragStartWorld;
    const q = pos;
    this.dragStartWorld = null;

    const minX = Math.min(p.x, q.x);
    const maxX = Math.max(p.x, q.x);
    const minY = Math.min(p.y, q.y);
    const maxY = Math.max(p.y, q.y);

    // 矩形が小さすぎれば無視
    if (maxX - minX < 1 && maxY - minY < 1) {
      view.clearPreview();
      view.render();
      return;
    }

    const ctrl = event.ctrlKey;
    const doc = Document.instance;
    const layer = doc.shownLayer;

    for (const data of doc.allDataList) {
      if (layer && !isOnLayer(data, layer)) continue;
      if (isInsideRect(data, minX, maxX, minY, maxY)) {
        if (ctrl) {
          data.select = !data.select;
        } else {
          data.select = true;
        }
      }
    }

    view.clearPreview();
    view.render();
  }
}

function isOnLayer(data: DocumentData, layer: import('../Layer').Layer): boolean {
  if (data instanceof Node) return data.existsOn(layer);
  if (data instanceof Member) return data.existsOn(layer);
  if (data instanceof Plane) return data.existsOn(layer);
  return false;
}

function isInsideRect(data: DocumentData, minX: number, maxX: number, minY: number, maxY: number): boolean {
  if (data instanceof Node) {
    return data.pos.x >= minX && data.pos.x <= maxX && data.pos.y >= minY && data.pos.y <= maxY;
  }
  if (data instanceof Member) {
    if (!data.ok) return false;
    return isInsideRect(data.nodeI! as any, minX, maxX, minY, maxY) &&
           isInsideRect(data.nodeJ! as any, minX, maxX, minY, maxY);
  }
  if (data instanceof Plane) {
    return data.nodeList.every(n =>
      n.pos.x >= minX && n.pos.x <= maxX && n.pos.y >= minY && n.pos.y <= maxY
    );
  }
  return false;
}
