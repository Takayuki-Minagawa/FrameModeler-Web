import * as THREE from 'three';
import { CAD } from './CadConfig';

/**
 * InputController がイベント処理を委譲する先（CadView が実装する）。
 * 各メソッドは CadView の元イベントハンドラ本体に対応する。
 */
export interface InputHost {
  /** 左クリック（handler.onClick 相当）。pos 計算は CadView 側。 */
  handleClick(e: MouseEvent): void;
  /** 左ダブルクリック（handler.onDoubleClick 相当）。 */
  handleDoubleClick(e: MouseEvent): void;
  /** マウス移動（ワールド座標更新・ハンドラ通知）。 */
  handleMouseMove(e: MouseEvent): void;
  /** 左ドラッグ終了（矩形選択確定など）。 */
  handleEndDrag(e: MouseEvent): void;
  /** ハンドラが設定されているか（左クリック分岐に使用）。 */
  readonly hasHandler: boolean;
  /** カメラのパン（dx,dy / px）＋カメラのみ再描画。 */
  panCamera(dx: number, dy: number): void;
  /** カメラの3D回転（dx,dy / px）＋カメラのみ再描画。 */
  rotateCamera(dx: number, dy: number): void;
  /** ホイールズーム＋再描画。 */
  zoomCamera(deltaY: number): void;
  /** リサイズ。 */
  resize(): void;
  /** 3D表示中か（回転/パン分岐に使用）。 */
  readonly show3D: boolean;
}

/**
 * DOMイベント専任クラス（V-5）。
 * canvas の mousedown/mousemove/mouseup/wheel/contextmenu と window resize を登録し、
 * ドラッグ状態・ダブルクリック検出を所有して host へ委譲する。
 * 判定しきい値・ボタン番号・分岐は CadView から無変更で移設。
 */
export class InputController {
  private canvas: HTMLCanvasElement;
  private host: InputHost;

  // ドラッグ状態
  private isDragging = false;
  private dragButton = -1;
  private dragStart = new THREE.Vector2();
  private dragPrev = new THREE.Vector2();

  // ダブルクリック検出
  private lastClickTime = 0;
  private lastClickPos = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement, host: InputHost) {
    this.canvas = canvas;
    this.host = host;

    this.canvas.addEventListener('mousedown', this.onCanvasMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onCanvasMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onCanvasMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onCanvasWheel.bind(this));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.host.resize());
  }

  private onCanvasMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.dragButton = e.button;
    this.dragStart.set(e.clientX, e.clientY);
    this.dragPrev.set(e.clientX, e.clientY);

    if (e.button === 0 && this.host.hasHandler) {
      // ダブルクリック検出
      const now = Date.now();
      const dx = e.clientX - this.lastClickPos.x;
      const dy = e.clientY - this.lastClickPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (now - this.lastClickTime < CAD.DBLCLICK_MS && dist < CAD.DBLCLICK_PX) {
        this.host.handleDoubleClick(e);
        this.lastClickTime = 0;
      } else {
        this.host.handleClick(e);
        this.lastClickTime = now;
        this.lastClickPos.set(e.clientX, e.clientY);
      }
    }
  }

  private onCanvasMouseMove(e: MouseEvent): void {
    this.host.handleMouseMove(e);

    if (this.isDragging) {
      const dx = e.clientX - this.dragPrev.x;
      const dy = e.clientY - this.dragPrev.y;

      if (this.dragButton === 2 || this.dragButton === 1) {
        if (this.host.show3D && this.dragButton === 2) {
          this.host.rotateCamera(dx, dy);
        } else {
          this.host.panCamera(dx, dy);
        }
      }

      this.dragPrev.set(e.clientX, e.clientY);
    }
  }

  private onCanvasMouseUp(e: MouseEvent): void {
    if (this.isDragging && this.dragButton === 0) {
      // 左ドラッグ終了 → SelectionHandler用
      this.host.handleEndDrag(e);
    }
    this.isDragging = false;
    this.dragButton = -1;
  }

  private onCanvasWheel(e: WheelEvent): void {
    e.preventDefault();
    this.host.zoomCamera(e.deltaY);
  }
}
