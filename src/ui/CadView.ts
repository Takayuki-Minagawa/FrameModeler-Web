import * as THREE from 'three';
import { Document } from '../data/Document';
import { DocumentData } from '../data/DocumentData';
import { Point3D } from '../math/Point3D';
import { CAD, getPalette, type CadPalette } from './CadConfig';
import type { ICadMouseHandler } from './handlers/ICadMouseHandler';
import { CadRenderer, type RenderContext } from './CadRenderer';
import { CameraController } from './CameraController';
import { InputController, type InputHost } from './InputController';

/**
 * CADビューのファサード（V-1/V-2/V-5 を束ねる）。
 * 描画は CadRenderer、カメラは CameraController、入力は InputController に委譲し、
 * 公開API（main.ts / ハンドラが使う）のシグネチャ・挙動を完全維持する。
 */
export class CadView implements InputHost {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private canvas: HTMLCanvasElement;

  private cadRenderer: CadRenderer;
  private cameraCtrl: CameraController;
  private inputCtrl: InputController;

  // 表示設定
  private _showGrid = true;
  private _gridWidth = 100;
  private _snapWidth = 10;
  private _snapping = true;

  // マウスワールド座標
  private _mouseWorldPos = new Point3D();

  // マウスハンドラ
  private _handler: ICadMouseHandler | null = null;

  // 現在のテーマに対応するカラーパレット（render毎に更新）
  private palette: CadPalette = getPalette();

  // 描画スケジューリング（V-3/V-11）
  private rafId = 0;
  private needsRebuild = true;

  // コールバック
  onMouseMove: ((pos: Point3D) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // レンダラー
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(this.palette.background);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // シーン
    this.scene = new THREE.Scene();

    // 描画・カメラ・入力
    this.cadRenderer = new CadRenderer(this.scene);
    this.cameraCtrl = new CameraController(() => {
      const container = this.canvas.parentElement!;
      return container.clientWidth / container.clientHeight;
    });
    this.inputCtrl = new InputController(this.canvas, this);

    this.resize();
  }

  // ========== ハンドラ ==========

  get handler(): ICadMouseHandler | null { return this._handler; }
  set handler(h: ICadMouseHandler | null) {
    this._handler = h;
    this.clearPreview();
    this.render();
  }

  // ========== プロパティ ==========

  get show3D(): boolean { return this.cameraCtrl.show3D; }
  set show3D(value: boolean) {
    if (this.cameraCtrl.show3D === value) return;
    this.cameraCtrl.show3D = value;
    this.render();
  }

  get showGrid(): boolean { return this._showGrid; }
  set showGrid(value: boolean) { this._showGrid = value; this.render(); }

  get gridWidth(): number { return this._gridWidth; }
  set gridWidth(value: number) { this._gridWidth = Math.max(5, value); this.render(); }

  get snapWidth(): number { return this._snapWidth; }
  set snapWidth(value: number) { this._snapWidth = value; }

  get snapping(): boolean { return this._snapping; }
  set snapping(value: boolean) { this._snapping = value; }

  get mouseWorldPos(): Point3D { return this._mouseWorldPos; }

  // ========== リサイズ ==========

  resize(): void {
    const container = this.canvas.parentElement!;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer.setSize(w, h);

    this.cameraCtrl.resize(w / h);

    this.render();
  }

  // ========== カメラ ==========

  /** シーン中心にカメラを合わせる */
  fitToScene(): void {
    this.cameraCtrl.fitToScene(Document.instance.sceneCenter);
    this.render();
  }

  // ========== スナップ ==========

  snap(pos: Point3D): Point3D {
    const snapped = pos.clone();
    for (let dir = 0; dir < 2; dir++) {
      const val = pos.get(dir);
      const rest = val % this._snapWidth;
      if (Math.abs(rest) < this._snapWidth / 2) {
        snapped.set(dir, val - rest);
      } else {
        snapped.set(dir, val - rest + (val > 0 ? this._snapWidth : -this._snapWidth));
      }
    }
    snapped.z = this.layerZ;
    return snapped;
  }

  // ========== マウス→ワールド座標変換 ==========

  screenToWorld(screenX: number, screenY: number): Point3D {
    const rect = this.canvas.getBoundingClientRect();
    return this.cameraCtrl.screenToWorld(screenX, screenY, this.layerZ, rect);
  }

  getMouseCoord(event: MouseEvent): Point3D {
    let pos = this.screenToWorld(event.clientX, event.clientY);
    if (this._snapping) pos = this.snap(pos);
    return pos;
  }

  // ========== ヒットテスト ==========

  /** ワールド座標近傍の要素を検索（選択ツール・ダブルクリック用） */
  hitTest(worldPos: Point3D): DocumentData | null {
    const doc = Document.instance;
    const layer = doc.shownLayer;
    const showAll = this.show3D || !layer;
    const hitRange = this.cameraCtrl.cameraDistance * CAD.HIT_RANGE_RATIO; // ピクセル相当の距離

    // Node優先
    for (const node of doc.nodeList) {
      if (!showAll && !node.existsOn(layer)) continue;
      if (node.pos.sub(worldPos).length <= hitRange) return node;
    }

    // Member
    for (const m of doc.memberList) {
      if (!m.ok) continue;
      if (!showAll && !m.existsOn(layer)) continue;
      if (distToSegment2D(worldPos, m.posI, m.posJ) <= hitRange) return m;
    }

    // Plane
    for (const p of doc.planeList) {
      if (!p.ok) continue;
      if (!showAll && !p.existsOn(layer)) continue;
      if (isInsidePolygon2D(worldPos, p.nodeList.map(n => n.pos))) return p;
    }

    return null;
  }

  // ========== 入力委譲（InputHost 実装） ==========

  get hasHandler(): boolean { return this._handler !== null; }

  handleClick(e: MouseEvent): void {
    const pos = this.getMouseCoord(e);
    this._handler!.onClick(this, pos, e);
  }

  handleDoubleClick(e: MouseEvent): void {
    const pos = this.getMouseCoord(e);
    this._handler!.onDoubleClick(this, pos, e);
  }

  handleMouseMove(e: MouseEvent): void {
    const worldPos = this.getMouseCoord(e);
    this._mouseWorldPos = worldPos;
    this.onMouseMove?.(worldPos);

    if (this._handler) {
      this._handler.onMouseMove(this, worldPos);
    }
  }

  handleEndDrag(e: MouseEvent): void {
    if (this._handler) {
      const pos = this.getMouseCoord(e);
      this._handler.onEndDrag?.(this, pos, e);
    }
  }

  panCamera(dx: number, dy: number): void {
    this.cameraCtrl.pan(dx, dy);
    // パン/回転はジオメトリを変えないため、再構築不要の描画でよい（V-3）
    this.renderCameraOnly();
  }

  rotateCamera(dx: number, dy: number): void {
    this.cameraCtrl.rotate(dx, dy);
    // パン/回転はジオメトリを変えないため、再構築不要の描画でよい（V-3）
    this.renderCameraOnly();
  }

  zoomCamera(deltaY: number): void {
    this.cameraCtrl.zoom(deltaY);
    this.render();
  }

  // ========== 描画 ==========

  /** テーマ変更時に背景色を更新して再描画する（B-2） */
  refreshTheme(): void {
    this.palette = getPalette();
    this.renderer.setClearColor(this.palette.background);
    this.render();
  }

  /** データ変更を伴う再描画。次フレームでシーンを再構築して描画する（V-11） */
  render(): void {
    this.needsRebuild = true;
    this.scheduleFrame();
  }

  /** カメラ操作のみの再描画。ジオメトリ再構築をスキップする（V-3） */
  private renderCameraOnly(): void {
    this.scheduleFrame();
  }

  /** requestAnimationFrame で1フレーム1回に描画を集約する */
  private scheduleFrame(): void {
    if (this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (this.needsRebuild) {
        this.rebuildScene();
        this.needsRebuild = false;
      }
      this.renderer.render(this.scene, this.cameraCtrl.camera);
    });
  }

  private rebuildScene(): void {
    this.palette = getPalette();
    const ctx: RenderContext = {
      palette: this.palette,
      show3D: this.show3D,
      cameraDistance: this.cameraCtrl.cameraDistance,
      layerZ: this.layerZ,
      showGrid: this._showGrid,
      gridWidth: this._gridWidth,
    };
    this.cadRenderer.rebuild(ctx);
  }

  clearPreview(): void {
    this.cadRenderer.clearPreview();
  }

  addPreviewLine(from: Point3D, to: Point3D, color: number = this.palette.preview): void {
    this.cadRenderer.addPreviewLine(from, to, color);
  }

  addPreviewPoint(pos: Point3D, color: number = this.palette.preview): void {
    this.cadRenderer.addPreviewPoint(pos, color);
  }

  /** 頂点列を閉ループとしてプレビュー線で描く（4辺ループ等の共通化用） */
  addPreviewPolygon(points: Point3D[], color: number = this.palette.preview): void {
    this.cadRenderer.addPreviewPolygon(points, color);
  }

  /** プレビュー用の現在パレット（ハンドラからの参照用） */
  get previewColor(): number { return this.palette.preview; }
  get selectionRectColor(): number { return this.palette.selectionRect; }

  /** 現在表示中レイヤーのZ高さ（無ければ0）（V-9） */
  private get layerZ(): number {
    return Document.instance.shownLayer?.posZ ?? 0;
  }
}

// ========== ヒットテスト用ユーティリティ ==========

/** 点から線分への2D距離 */
function distToSegment2D(p: Point3D, a: Point3D, b: Point3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

/** 点がポリゴン内にあるか (2D, ray casting) */
function isInsidePolygon2D(p: Point3D, vertices: Point3D[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
