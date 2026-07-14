import * as THREE from 'three';
import { Document } from '../data/Document';
import { DocumentData } from '../data/DocumentData';
import { Point3D } from '../math/Point3D';
import { CAD, getPalette, type CadPalette } from './CadConfig';
import type { ICadMouseHandler } from './handlers/ICadMouseHandler';
import { CadRenderer, type RenderContext } from './CadRenderer';
import { CameraController, type WorkPlaneIntersectionError } from './CameraController';
import { InputController, type InputHost } from './InputController';
import { ObjectSnapEngine, type ObjectSnapKind, type ObjectSnapResult } from './ObjectSnapEngine';

const enum DirtyFlag {
  Camera = 1 << 0,
  Grid = 1 << 1,
  Elements = 1 << 2,
  Selection = 1 << 3,
  Preview = 1 << 4,
}

/** CADビューの公開ファサード。描画・カメラ・入力のライフサイクルを束ねる。 */
export class CadView implements InputHost {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly cadRenderer: CadRenderer;
  private readonly cameraCtrl: CameraController;
  private readonly inputCtrl: InputController;
  private readonly objectSnapEngine = new ObjectSnapEngine();

  private _showGrid = true;
  private _gridWidth = 100;
  private _snapWidth = 10;
  private _snapping = true;
  private _mouseWorldPos = new Point3D();
  private _handler: ICadMouseHandler | null = null;
  private palette: CadPalette = getPalette();

  private rafId = 0;
  private dirtyFlags = DirtyFlag.Camera | DirtyFlag.Grid | DirtyFlag.Elements | DirtyFlag.Selection | DirtyFlag.Preview;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private renderable = false;
  private disposed = false;
  private activeScreenPoint: THREE.Vector2 | null = null;
  private lastWorkPlaneError: WorkPlaneIntersectionError | null = null;
  private readonly originalCanvasTitle: string;
  private _currentSnapResult: ObjectSnapResult = {
    position: new Point3D(),
    kind: 'none',
    distancePx: 0,
    source: null,
  };

  onMouseMove: ((pos: Point3D) => void) | null = null;
  /** kind/位置が変わった時に、ステータス表示やsnap glyphへ通知する。 */
  onSnapChanged: ((result: Readonly<ObjectSnapResult>) => void) | null = null;
  /** nullはエラー解消。main等からステータス表示へ接続できる。 */
  onWorkPlaneUnavailable: ((message: string | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.originalCanvasTitle = canvas.title;
    this.canvas.dataset.snapKind = 'none';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(this.palette.background);
    this.renderer.setPixelRatio(this.getPixelRatio());
    this.scene = new THREE.Scene();

    this.cadRenderer = new CadRenderer(this.scene);
    this.cameraCtrl = new CameraController(
      () => (this.viewportHeight > 0 ? this.viewportWidth / this.viewportHeight : 1),
      () => Math.max(1, this.viewportHeight),
    );
    this.inputCtrl = new InputController(this.canvas, this);
    this.resize();
  }

  get handler(): ICadMouseHandler | null {
    return this._handler;
  }
  set handler(handler: ICadMouseHandler | null) {
    this._handler = handler;
    this.inputCtrl.resetGestureState();
    this.clearPreview();
    this.renderPreview();
  }

  get show3D(): boolean {
    return this.cameraCtrl.show3D;
  }
  set show3D(value: boolean) {
    if (this.cameraCtrl.show3D === value) return;
    this.cameraCtrl.show3D = value;
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid | DirtyFlag.Elements | DirtyFlag.Selection);
  }

  get showGrid(): boolean {
    return this._showGrid;
  }
  set showGrid(value: boolean) {
    if (this._showGrid === value) return;
    this._showGrid = value;
    this.invalidate(DirtyFlag.Grid);
  }

  get gridWidth(): number {
    return this._gridWidth;
  }
  set gridWidth(value: number) {
    const width = Number.isFinite(value) ? Math.max(5, value) : 100;
    if (this._gridWidth === width) return;
    this._gridWidth = width;
    this.invalidate(DirtyFlag.Grid);
  }

  get snapWidth(): number {
    return this._snapWidth;
  }
  set snapWidth(value: number) {
    this._snapWidth = Number.isFinite(value) && value > 0 ? value : 10;
  }

  get snapping(): boolean {
    return this._snapping;
  }
  set snapping(value: boolean) {
    this._snapping = value;
    if (!value) this.updateCurrentSnap(createUnsnappedResult(this._mouseWorldPos, this.layerZ));
  }
  get mouseWorldPos(): Point3D {
    return this._mouseWorldPos;
  }
  get currentSnapKind(): ObjectSnapKind {
    return this._currentSnapResult.kind;
  }
  get currentSnapResult(): Readonly<ObjectSnapResult> {
    return cloneSnapResult(this._currentSnapResult);
  }

  resize(): void {
    if (this.disposed) return;
    const container = this.canvas.parentElement;
    const width = container?.clientWidth ?? this.canvas.clientWidth;
    const height = container?.clientHeight ?? this.canvas.clientHeight;
    if (width <= 0 || height <= 0) {
      this.renderable = false;
      return;
    }

    this.renderable = true;
    const sizeChanged = width !== this.viewportWidth || height !== this.viewportHeight;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.renderer.setPixelRatio(this.getPixelRatio());
    if (sizeChanged) this.renderer.setSize(width, height, false);
    this.cameraCtrl.resize(width / height);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  fitToScene(): void {
    const bounds = this.getModelBounds();
    this.cameraCtrl.fitToBounds(bounds);
    this.cameraCtrl.set2DWorkPlaneElevation(this.layerZ);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  snap(pos: Point3D): Point3D {
    const snapped = pos.clone();
    snapped.x = Math.round(snapped.x / this._snapWidth) * this._snapWidth;
    snapped.y = Math.round(snapped.y / this._snapWidth) * this._snapWidth;
    snapped.z = this.layerZ;
    return snapped;
  }

  screenToWorld(screenX: number, screenY: number): Point3D | null {
    this.cameraCtrl.set2DWorkPlaneElevation(this.layerZ);
    const pos = this.cameraCtrl.screenToWorld(screenX, screenY, this.layerZ, this.canvas.getBoundingClientRect());
    this.updateWorkPlaneError(this.cameraCtrl.lastScreenToWorldError);
    return pos;
  }

  getMouseCoord(event: MouseEvent): Point3D | null {
    const position = this.screenToWorld(event.clientX, event.clientY);
    if (!position) {
      this.updateCurrentSnap(createUnsnappedResult(this._mouseWorldPos, this.layerZ));
      return null;
    }
    if (!this._snapping || event.altKey) {
      const result = createUnsnappedResult(position, this.layerZ);
      this.updateCurrentSnap(result);
      return result.position.clone();
    }

    const rect = this.canvas.getBoundingClientRect();
    const doc = Document.instance;
    const result = this.objectSnapEngine.resolve({
      position,
      screenPoint: { x: event.clientX, y: event.clientY },
      workPlaneZ: this.layerZ,
      gridSpacing: this._snapWidth,
      tolerancePx: CAD.OBJECT_SNAP_TOLERANCE_PX,
      nodes: doc.nodeList,
      members: doc.memberList,
      project: (point) => this.cameraCtrl.worldToScreen(point, rect),
    });
    this.updateCurrentSnap(result);
    return result.position.clone();
  }

  /**
   * 2Dは専用screen-space判定、3Dは実描画geometryへのRaycaster交点を深度順に返す。
   * worldPosだけを渡す従来呼出しも、投影してscreen位置を復元する。
   */
  hitTest(worldPos: Point3D): DocumentData | null {
    const rect = this.canvas.getBoundingClientRect();
    const screen = this.activeScreenPoint ?? this.cameraCtrl.worldToScreen(worldPos, rect);
    if (!screen) return null;
    if (!this.show3D) {
      return this.cadRenderer.hitTest2D(screen.x, screen.y, this.cameraCtrl, rect);
    }

    this.ensureElementsCurrent();
    const raycaster = new THREE.Raycaster();
    if (!this.cameraCtrl.setRayFromScreen(raycaster, screen.x, screen.y, rect)) return null;
    const threshold = this.maxWorldHitTolerance();
    raycaster.params.Line = { threshold };
    raycaster.params.Points = { threshold };

    const candidates = this.cadRenderer.raycast(raycaster).filter(({ intersection }) => {
      if (intersection.object instanceof THREE.Mesh) return true;
      const projected = this.cameraCtrl.worldToScreen(intersection.point, rect);
      return !!projected && projected.distanceTo(screen) <= CAD.HIT_TOLERANCE_PX;
    });
    candidates.sort((a, b) => {
      const depth = a.intersection.distance - b.intersection.distance;
      if (Math.abs(depth) > 1e-7) return depth;
      return hitPriority(a.data) - hitPriority(b.data);
    });
    return candidates[0]?.data ?? null;
  }

  // ========== InputHost ==========

  get hasHandler(): boolean {
    return this._handler !== null;
  }
  get acceptsDoubleClick(): boolean {
    return this._handler?.acceptsDoubleClick === true;
  }

  handleClick(event: MouseEvent): void {
    if (!this._handler) return;
    const pos = this.getMouseCoord(event);
    if (!pos) return;
    this.withScreenPoint(event, () => this._handler?.onClick(this, pos, event));
  }

  handleDoubleClick(event: MouseEvent): void {
    if (!this._handler || !this.acceptsDoubleClick) return;
    const pos = this.getMouseCoord(event);
    if (!pos) return;
    this.withScreenPoint(event, () => this._handler?.onDoubleClick(this, pos, event));
  }

  handleMouseMove(event: MouseEvent): void {
    const worldPos = this.getMouseCoord(event);
    if (!worldPos) return;
    this._mouseWorldPos = worldPos;
    this.onMouseMove?.(worldPos);
    // handler previewとsnap markerを同じ永続bufferへ毎frame描き直す。
    this.clearPreview();
    this.withScreenPoint(event, () => this._handler?.onMouseMove(this, worldPos));
    if (!event.altKey && !['none', 'grid'].includes(this._currentSnapResult.kind)) {
      this.addPreviewPoint(this._currentSnapResult.position, this.palette.preview);
    }
    this.renderPreview();
  }

  handleEndDrag(event: MouseEvent, dragDistancePx: number): void {
    if (!this._handler?.onEndDrag) return;
    const pos = this.getMouseCoord(event);
    if (!pos) {
      // 作業平面が無効でもhandler内部のdrag状態は必ず解除する。
      this._handler.onEndDrag(this, this._mouseWorldPos.clone(), event, 0);
      return;
    }
    this.withScreenPoint(event, () => this._handler?.onEndDrag?.(this, pos, event, dragDistancePx));
  }

  panCamera(dx: number, dy: number): void {
    this.cameraCtrl.pan(dx, dy);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  rotateCamera(dx: number, dy: number): void {
    this.cameraCtrl.rotate(dx, dy);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  zoomCamera(deltaY: number): void {
    this.cameraCtrl.zoom(deltaY);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  // ========== invalidation/render ==========

  /** 従来API: layer/model変更を想定しgridとelementsを更新する。 */
  render(): void {
    this.cameraCtrl.setSceneBounds(this.getModelBounds());
    this.cameraCtrl.set2DWorkPlaneElevation(this.layerZ);
    this.invalidate(DirtyFlag.Grid | DirtyFlag.Elements | DirtyFlag.Selection);
  }

  renderElements(): void {
    this.cameraCtrl.setSceneBounds(this.getModelBounds());
    this.invalidate(DirtyFlag.Elements | DirtyFlag.Selection);
  }

  renderSelection(): void {
    this.invalidate(DirtyFlag.Selection);
  }

  renderPreview(): void {
    this.invalidate(DirtyFlag.Preview);
  }

  refreshTheme(): void {
    this.palette = getPalette();
    this.renderer.setClearColor(this.palette.background);
    this.clearPreview();
    this.invalidate(DirtyFlag.Grid | DirtyFlag.Selection | DirtyFlag.Preview);
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

  addPreviewPolygon(points: Point3D[], color: number = this.palette.preview): void {
    this.cadRenderer.addPreviewPolygon(points, color);
  }

  get previewColor(): number {
    return this.palette.preview;
  }
  get selectionRectColor(): number {
    return this.palette.selectionRect;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.inputCtrl.dispose();
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.cadRenderer.dispose();
    this.renderer.dispose();
    this.onMouseMove = null;
    this.onSnapChanged = null;
    this.onWorkPlaneUnavailable = null;
    this.canvas.title = this.originalCanvasTitle;
    delete this.canvas.dataset.snapKind;
    delete this.canvas.dataset.workPlaneError;
  }

  private invalidate(flags: number): void {
    if (this.disposed) return;
    this.dirtyFlags |= flags;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (!this.renderable || this.rafId !== 0 || this.disposed) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.renderable || this.disposed) return;
      const context = this.createRenderContext();

      if ((this.dirtyFlags & DirtyFlag.Grid) !== 0) this.cadRenderer.rebuildGrid(context);
      if ((this.dirtyFlags & DirtyFlag.Elements) !== 0) {
        this.cadRenderer.rebuildElements(context);
        this.dirtyFlags &= ~DirtyFlag.Selection;
      } else if ((this.dirtyFlags & DirtyFlag.Selection) !== 0) {
        this.cadRenderer.updateSelection(context);
      }

      this.dirtyFlags = 0;
      this.renderer.render(this.scene, this.cameraCtrl.camera);
    });
  }

  private ensureElementsCurrent(): void {
    if ((this.dirtyFlags & DirtyFlag.Elements) === 0) return;
    this.cadRenderer.rebuildElements(this.createRenderContext());
    this.dirtyFlags &= ~(DirtyFlag.Elements | DirtyFlag.Selection);
  }

  private createRenderContext(): RenderContext {
    this.cameraCtrl.set2DWorkPlaneElevation(this.layerZ);
    this.palette = getPalette();
    const rect = this.canvas.getBoundingClientRect();
    return {
      palette: this.palette,
      show3D: this.show3D,
      cameraDistance: this.cameraCtrl.cameraDistance,
      cameraCenter: this.cameraCtrl.cameraCenter,
      layerZ: this.layerZ,
      showGrid: this._showGrid,
      gridWidth: this._gridWidth,
      gridBounds: this.cameraCtrl.getGridBounds(this.layerZ, rect),
    };
  }

  private maxWorldHitTolerance(): number {
    let maxUnitsPerPixel = this.cameraCtrl.worldUnitsPerPixelAt(this.cameraCtrl.cameraCenter);
    for (const node of Document.instance.nodeList) {
      maxUnitsPerPixel = Math.max(maxUnitsPerPixel, this.cameraCtrl.worldUnitsPerPixelAt(node.pos));
    }
    return maxUnitsPerPixel * CAD.HIT_TOLERANCE_PX;
  }

  private getModelBounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const node of Document.instance.nodeList) {
      if (![node.pos.x, node.pos.y, node.pos.z].every(Number.isFinite)) continue;
      bounds.expandByPoint(new THREE.Vector3(node.pos.x, node.pos.y, node.pos.z));
    }
    return bounds;
  }

  private withScreenPoint(event: MouseEvent, callback: () => void): void {
    const previous = this.activeScreenPoint;
    this.activeScreenPoint = new THREE.Vector2(event.clientX, event.clientY);
    try {
      callback();
    } finally {
      this.activeScreenPoint = previous;
    }
  }

  private updateWorkPlaneError(error: WorkPlaneIntersectionError | null): void {
    if (this.lastWorkPlaneError === error) return;
    this.lastWorkPlaneError = error;
    const message = workPlaneErrorMessage(error);
    if (message) {
      this.canvas.dataset.workPlaneError = message;
      this.canvas.title = message;
    } else {
      delete this.canvas.dataset.workPlaneError;
      this.canvas.title = this.originalCanvasTitle;
    }
    this.onWorkPlaneUnavailable?.(message);
  }

  private updateCurrentSnap(result: ObjectSnapResult): void {
    const changed = !sameSnapResult(this._currentSnapResult, result);
    this._currentSnapResult = cloneSnapResult(result);
    this.canvas.dataset.snapKind = result.kind;
    if (changed) this.onSnapChanged?.(this.currentSnapResult);
  }

  private getPixelRatio(): number {
    const ratio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    return Math.min(Math.max(1, ratio || 1), CAD.MAX_PIXEL_RATIO);
  }

  private get layerZ(): number {
    return Document.instance.shownLayer?.posZ ?? 0;
  }
}

function createUnsnappedResult(position: Point3D, workPlaneZ: number): ObjectSnapResult {
  const raw = position.clone();
  raw.z = workPlaneZ;
  return { position: raw, kind: 'none', distancePx: 0, source: null };
}

function cloneSnapResult(result: ObjectSnapResult): ObjectSnapResult {
  const source = Array.isArray(result.source) ? ([result.source[0], result.source[1]] as const) : result.source;
  return { ...result, position: result.position.clone(), source };
}

function sameSnapResult(a: ObjectSnapResult, b: ObjectSnapResult): boolean {
  return a.kind === b.kind && sameSnapSource(a.source, b.source) && a.position.equals(b.position);
}

function sameSnapSource(a: ObjectSnapResult['source'], b: ObjectSnapResult['source']): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a[0] === b[0] && a[1] === b[1];
}

function hitPriority(data: DocumentData): number {
  const name = data.constructor.name;
  if (name === 'Node') return 0;
  if (name === 'Beam' || name === 'Pillar') return 1;
  return 2;
}

function workPlaneErrorMessage(error: WorkPlaneIntersectionError | null): string | null {
  switch (error) {
    case 'viewport-unavailable':
      return '表示領域のサイズが0のため操作できません';
    case 'parallel':
      return '視線が現在レイヤーの作業平面と平行なため配置できません';
    case 'behind':
      return '現在レイヤーの作業平面がカメラ後方にあるため配置できません';
    default:
      return null;
  }
}
