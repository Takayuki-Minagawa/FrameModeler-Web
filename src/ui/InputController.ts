import * as THREE from 'three';
import { CAD } from './CadConfig';

export interface InputHost {
  handleClick(e: MouseEvent): void;
  handleDoubleClick(e: MouseEvent): void;
  handleMouseMove(e: MouseEvent): void;
  /** dragDistancePxはpointerdownからの最大CSS pixel距離。 */
  handleEndDrag(e: MouseEvent, dragDistancePx: number): void;
  readonly hasHandler: boolean;
  /** 選択系ツールなど、ダブルクリックgestureを必要とする場合のみtrue。 */
  readonly acceptsDoubleClick: boolean;
  panCamera(dx: number, dy: number): void;
  rotateCamera(dx: number, dy: number): void;
  zoomCamera(deltaY: number): void;
  resize(): void;
  readonly show3D: boolean;
}

/** Pointer Events、pointer capture、要素resizeのライフサイクルを管理する。 */
export class InputController {
  private activePointerId: number | null = null;
  private dragButton = -1;
  private readonly dragStart = new THREE.Vector2();
  private readonly dragPrev = new THREE.Vector2();
  private maxDragDistance = 0;

  // クリック自体は常にhostへ渡し、この状態はnative dblclickの妥当性確認だけに使う。
  private gestureGeneration = 0;
  private lastPrimaryDownTime = 0;
  private readonly lastPrimaryDownPos = new THREE.Vector2();
  private lastPrimaryDownGeneration = -1;
  private pendingDoubleClick = false;

  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private readonly previousTouchAction: string;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: InputHost,
  ) {
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.host.resize());
      this.resizeObserver.observe(canvas.parentElement ?? canvas);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onWindowResize);
    }
  }

  /** ツール/コンテキスト切替をまたぐdblclickを成立させない。 */
  resetGestureState(): void {
    this.gestureGeneration++;
    this.lastPrimaryDownTime = 0;
    this.lastPrimaryDownGeneration = -1;
    this.pendingDoubleClick = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onWindowResize);
    this.canvas.style.touchAction = this.previousTouchAction;
    this.clearPointerState();
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.disposed || this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.dragButton = e.button;
    this.dragStart.set(e.clientX, e.clientY);
    this.dragPrev.copy(this.dragStart);
    this.maxDragDistance = 0;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 古いブラウザやsynthetic eventでも入力処理自体は継続する。
    }

    if (e.button === 0 && this.host.hasHandler) {
      const now = Date.now();
      const distance = this.lastPrimaryDownPos.distanceTo(new THREE.Vector2(e.clientX, e.clientY));
      const sameContext = this.lastPrimaryDownGeneration === this.gestureGeneration;
      this.pendingDoubleClick =
        this.host.acceptsDoubleClick &&
        sameContext &&
        now - this.lastPrimaryDownTime < CAD.DBLCLICK_MS &&
        distance < CAD.DBLCLICK_PX;

      // 2点作図ではこの2回目も必ずcommit候補になる。
      this.host.handleClick(e);
      this.lastPrimaryDownTime = now;
      this.lastPrimaryDownPos.set(e.clientX, e.clientY);
      this.lastPrimaryDownGeneration = this.gestureGeneration;
    } else {
      this.pendingDoubleClick = false;
    }
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;
    this.host.handleMouseMove(e);
    if (e.pointerId !== this.activePointerId) return;

    const dx = e.clientX - this.dragPrev.x;
    const dy = e.clientY - this.dragPrev.y;
    this.maxDragDistance = Math.max(
      this.maxDragDistance,
      Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y),
    );

    if (this.dragButton === 2 || this.dragButton === 1) {
      if (this.host.show3D && this.dragButton === 2) {
        this.host.rotateCamera(dx, dy);
      } else {
        this.host.panCamera(dx, dy);
      }
    }
    this.dragPrev.set(e.clientX, e.clientY);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.finishPointer(e, false);
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.finishPointer(e, true);
  };

  private readonly onLostPointerCapture = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    // captureが外部要因で失われた場合は矩形選択を確定せずキャンセルする。
    this.finishPointer(e, true, false);
  };

  private readonly onDoubleClick = (e: MouseEvent): void => {
    if (e.button !== 0 || !this.pendingDoubleClick || !this.host.hasHandler || !this.host.acceptsDoubleClick) {
      return;
    }
    this.pendingDoubleClick = false;
    this.host.handleDoubleClick(e);
    e.preventDefault();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.host.zoomCamera(e.deltaY);
  };

  private readonly onContextMenu = (e: MouseEvent): void => e.preventDefault();
  private readonly onWindowResize = (): void => this.host.resize();

  private finishPointer(e: PointerEvent, cancelled: boolean, releaseCapture = true): void {
    const pointerId = this.activePointerId;
    const button = this.dragButton;
    const distance = cancelled ? 0 : this.maxDragDistance;
    this.clearPointerState();

    if (button === 0 && this.host.hasHandler) this.host.handleEndDrag(e, distance);
    if (releaseCapture && pointerId !== null) {
      try {
        if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
      } catch {
        // capture未設定でも終了状態は既に解放済み。
      }
    }
  }

  private clearPointerState(): void {
    this.activePointerId = null;
    this.dragButton = -1;
    this.maxDragDistance = 0;
  }
}
