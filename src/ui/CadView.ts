import * as THREE from 'three';
import { Document } from '../data/Document';
import { DocumentData } from '../data/DocumentData';
import { Point3D } from '../math/Point3D';
import { CAD, getPalette, type CadPalette } from './CadConfig';
import type { ICadMouseHandler } from './handlers/ICadMouseHandler';
import { CadRenderer, type RenderContext } from './CadRenderer';
import { CameraController, type WorkPlaneIntersectionError } from './CameraController';
import { InputController, type InputHost } from './InputController';
import {
  cycleObjectSnapCandidate,
  getObjectSnapCandidateKind,
  getObjectSnapKindInfo,
  ObjectSnapEngine,
  type ObjectSnapCandidateKind,
  type ObjectSnapConstraintKind,
  type ObjectSnapResult,
} from './ObjectSnapEngine';
import { DisplayFilter } from '../display/DisplayFilter';
import { createDisplayLabelDescriptors, DisplayLabelOptions, type DisplayLabelOption } from '../display/DisplayLabels';
import { Member } from '../data/Member';
import { Node } from '../data/Node';
import { Plane } from '../data/Plane';
import { CadLabelRenderer } from './CadLabelRenderer';
import { Support } from '../data/Support';
import { Constraint } from '../data/Constraint';

const enum DirtyFlag {
  Camera = 1 << 0,
  Grid = 1 << 1,
  Elements = 1 << 2,
  Selection = 1 << 3,
  Preview = 1 << 4,
}

/** 作図ハンドラからステータスバーへ渡す、翻訳非依存の操作状態。 */
export type CadOperationStatus = 'firstPointSelected' | 'noPointAbove' | 'coincidentPoints' | 'duplicateElement';

/** CADビューの公開ファサード。描画・カメラ・入力のライフサイクルを束ねる。 */
export class CadView implements InputHost {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly cadRenderer: CadRenderer;
  private readonly cameraCtrl: CameraController;
  private readonly inputCtrl: InputController;
  private readonly objectSnapEngine = new ObjectSnapEngine();
  private readonly unsubscribeDisplayFilter: () => void;
  readonly displayFilter = new DisplayFilter();
  readonly displayLabels = new DisplayLabelOptions();
  private readonly labelRenderer: CadLabelRenderer;
  private readonly snapGlyph: HTMLDivElement | null;
  private lastSnapCandidates: ReadonlyArray<ObjectSnapResult> = [];
  private selectedSnapCandidateId: string | null = null;
  private _snapConstraintMode: 'all' | 'axis' | 'orthogonal' | 'none' = 'all';

  private _showGrid = true;
  private _gridWidth = 100;
  private _snapWidth = 10;
  private _snapping = true;
  private _mouseWorldPos = new Point3D();
  private _handler: ICadMouseHandler | null = null;
  private _operationStatus: CadOperationStatus | null = null;
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
  onSelectionChanged: ((selected: ReadonlyArray<DocumentData>) => void) | null = null;
  onOperationStatusChanged: ((status: CadOperationStatus | null) => void) | null = null;
  /** kind/位置が変わった時に、ステータス表示やsnap glyphへ通知する。 */
  onSnapChanged: ((result: Readonly<ObjectSnapResult>) => void) | null = null;
  /** nullはエラー解消。main等からステータス表示へ接続できる。 */
  onWorkPlaneUnavailable: ((message: string | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.originalCanvasTitle = canvas.title;
    this.canvas.dataset.snapKind = 'none';
    this.canvas.dataset.selectedCount = '0';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(this.palette.background);
    this.renderer.setPixelRatio(this.getPixelRatio());
    this.scene = new THREE.Scene();

    this.cadRenderer = new CadRenderer(this.scene, this.displayFilter);
    this.labelRenderer = new CadLabelRenderer(canvas);
    const ownerDocument = canvas.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    this.snapGlyph = ownerDocument?.createElement('div') ?? null;
    if (this.snapGlyph) {
      this.snapGlyph.className = 'cad-snap-glyph';
      this.snapGlyph.hidden = true;
      this.snapGlyph.setAttribute('aria-hidden', 'true');
      canvas.parentElement?.appendChild(this.snapGlyph);
    }
    this.cameraCtrl = new CameraController(
      () => (this.viewportHeight > 0 ? this.viewportWidth / this.viewportHeight : 1),
      () => Math.max(1, this.viewportHeight),
    );
    this.inputCtrl = new InputController(this.canvas, this);
    this.unsubscribeDisplayFilter = this.displayFilter.subscribe(() => {
      this.resetCurrentSnap();
      this.invalidate(DirtyFlag.Elements | DirtyFlag.Selection);
    });
    this.resize();
  }

  get handler(): ICadMouseHandler | null {
    return this._handler;
  }
  set handler(handler: ICadMouseHandler | null) {
    this._handler = handler;
    this.setOperationStatus(null);
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
    if (!value) {
      this.clearSnapCandidates();
      this.updateCurrentSnap(createUnsnappedResult(this._mouseWorldPos, this.layerZ));
    }
  }
  get mouseWorldPos(): Point3D {
    return this._mouseWorldPos;
  }
  get currentSnapKind(): ObjectSnapCandidateKind {
    return getObjectSnapCandidateKind(this._currentSnapResult);
  }
  get currentSnapResult(): Readonly<ObjectSnapResult> {
    return cloneSnapResult(this._currentSnapResult);
  }

  get operationStatus(): CadOperationStatus | null {
    return this._operationStatus;
  }

  setOperationStatus(status: CadOperationStatus | null): void {
    if (this._operationStatus === status) return;
    this._operationStatus = status;
    if (status) this.canvas.dataset.operationStatus = status;
    else delete this.canvas.dataset.operationStatus;
    this.onOperationStatusChanged?.(status);
  }

  get constraintAnchor(): Point3D | null {
    return this._handler?.getConstraintAnchor?.() ?? null;
  }

  get snapConstraintMode(): 'all' | 'axis' | 'orthogonal' | 'none' {
    return this._snapConstraintMode;
  }

  set snapConstraintMode(value: 'all' | 'axis' | 'orthogonal' | 'none') {
    this._snapConstraintMode = value;
    this.selectedSnapCandidateId = null;
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
    this.cadRenderer.setViewportSize(width, height);
    this.cameraCtrl.resize(width / height);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  fitToScene(): void {
    const bounds = this.getModelBounds();
    this.cameraCtrl.fitToBounds(bounds);
    this.cameraCtrl.set2DWorkPlaneElevation(this.layerZ);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  fitToData(data: ReadonlyArray<DocumentData>): void {
    const bounds = new THREE.Box3();
    for (const item of data) {
      if (item instanceof Node) bounds.expandByPoint(toVector3(item.pos));
      else if (item instanceof Member && item.ok) {
        bounds.expandByPoint(toVector3(item.posI));
        bounds.expandByPoint(toVector3(item.posJ));
      } else if (item instanceof Plane) {
        for (const node of item.nodeList) bounds.expandByPoint(toVector3(node.pos));
      } else if (item instanceof Support && item.node) {
        bounds.expandByPoint(toVector3(item.node.pos));
      } else if (item instanceof Constraint) {
        if (item.slaveNode) bounds.expandByPoint(toVector3(item.slaveNode.pos));
        for (const term of item.terms) bounds.expandByPoint(toVector3(term.node.pos));
      }
    }
    if (bounds.isEmpty()) return;
    this.cameraCtrl.fitToBounds(bounds);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid);
  }

  setStandardView(view: 'top' | 'front' | 'right' | 'isometric'): void {
    this.cameraCtrl.setStandardView(view);
    this.invalidate(DirtyFlag.Camera | DirtyFlag.Grid | DirtyFlag.Elements | DirtyFlag.Selection);
  }

  setLabelEnabled(option: DisplayLabelOption, enabled: boolean): void {
    this.displayLabels.setEnabled(option, enabled);
    this.invalidate(DirtyFlag.Camera);
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
      const elevationView = this.cameraCtrl.standardView === 'front' || this.cameraCtrl.standardView === 'right';
      if (elevationView && this._handler?.supportsElevationPicking) {
        this.updateWorkPlaneError(null);
        const fallback = new Point3D(
          this.cameraCtrl.cameraCenter.x,
          this.cameraCtrl.cameraCenter.y,
          this.cameraCtrl.cameraCenter.z,
        );
        this.updateCurrentSnap(createUnsnappedResult(fallback, fallback.z));
        return fallback;
      }
      this.updateCurrentSnap(createUnsnappedResult(this._mouseWorldPos, this.layerZ));
      return null;
    }
    if (!this._snapping || event.altKey) {
      this.clearSnapCandidates();
      const result = createUnsnappedResult(position, this.layerZ);
      this.updateCurrentSnap(result);
      return result.position.clone();
    }

    const rect = this.canvas.getBoundingClientRect();
    const doc = Document.instance;
    const anchor = this.constraintAnchor;
    const selectedMember = doc.memberList.find(
      (member) => member.select && member.ok && doc.isDataVisible(member) && this.displayFilter.allows(member),
    );
    const candidates = this.objectSnapEngine.resolveCandidates({
      position,
      screenPoint: { x: event.clientX, y: event.clientY },
      workPlaneZ: this.layerZ,
      gridSpacing: this._snapWidth,
      tolerancePx: CAD.OBJECT_SNAP_TOLERANCE_PX,
      nodes: doc.nodeList.filter((node) => doc.isDataVisible(node) && this.displayFilter.allows(node)),
      members: doc.memberList.filter((member) => doc.isDataVisible(member) && this.displayFilter.allows(member)),
      project: (point) => this.cameraCtrl.worldToScreen(point, rect),
      constraints:
        anchor && this._snapConstraintMode !== 'none'
          ? {
              anchor,
              kinds: constraintKinds(this._snapConstraintMode),
              screenToWorkPlane: (screen) =>
                this.cameraCtrl.screenToWorld(screen.x, screen.y, this.layerZ, this.canvas.getBoundingClientRect()),
              orthogonalTo: selectedMember?.posJ.sub(selectedMember.posI),
            }
          : undefined,
    });
    this.lastSnapCandidates = candidates;
    const result =
      candidates.find((candidate) => candidate.candidateId === this.selectedSnapCandidateId) ?? candidates[0];
    this.selectedSnapCandidateId = result.candidateId ?? null;
    this.updateCurrentSnap(result);
    return result.position.clone();
  }

  cycleSnapCandidate(direction: number = 1): boolean {
    if (!this._snapping) return false;
    const selection = cycleObjectSnapCandidate(this.lastSnapCandidates, this.selectedSnapCandidateId, direction);
    if (!selection) return false;
    this.selectedSnapCandidateId = selection.candidate.candidateId ?? null;
    this.updateCurrentSnap(selection.candidate);
    this._mouseWorldPos = selection.candidate.position.clone();
    this.onMouseMove?.(this._mouseWorldPos);
    this.renderPreview();
    return true;
  }

  /**
   * 2Dは専用screen-space判定、3Dは実描画geometryへのRaycaster交点を深度順に返す。
   * worldPosだけを渡す従来呼出しも、投影してscreen位置を復元する。
   */
  hitTest(worldPos: Point3D, predicate: (data: DocumentData) => boolean = () => true): DocumentData | null {
    const rect = this.canvas.getBoundingClientRect();
    const screen = this.activeScreenPoint ?? this.cameraCtrl.worldToScreen(worldPos, rect);
    if (!screen) return null;
    if (!this.show3D) {
      const elevationView = this.cameraCtrl.standardView === 'front' || this.cameraCtrl.standardView === 'right';
      return this.cadRenderer.hitTest2D(
        screen.x,
        screen.y,
        this.cameraCtrl,
        rect,
        CAD.HIT_TOLERANCE_PX,
        predicate,
        elevationView,
      );
    }

    this.ensureElementsCurrent();
    const raycaster = new THREE.Raycaster();
    if (!this.cameraCtrl.setRayFromScreen(raycaster, screen.x, screen.y, rect)) return null;
    const threshold = this.maxWorldHitTolerance();
    raycaster.params.Line = { threshold };
    raycaster.params.Points = { threshold };

    const candidates = this.cadRenderer.raycast(raycaster).filter(({ data, intersection }) => {
      if (!predicate(data)) return false;
      if (Document.instance.isDataLocked(data)) return false;
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
    if (!event.altKey && !['none', 'grid'].includes(getObjectSnapCandidateKind(this._currentSnapResult))) {
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
    this.resetCurrentSnap();
    this.cameraCtrl.setSceneBounds(this.getModelBounds());
    this.cameraCtrl.set2DWorkPlaneElevation(this.layerZ);
    this.invalidate(DirtyFlag.Grid | DirtyFlag.Elements | DirtyFlag.Selection);
  }

  renderElements(): void {
    this.resetCurrentSnap();
    this.cameraCtrl.setSceneBounds(this.getModelBounds());
    this.invalidate(DirtyFlag.Elements | DirtyFlag.Selection);
  }

  renderSelection(): void {
    const selected = Document.instance.allDataList.filter((data) => data.select);
    this.canvas.dataset.selectedCount = String(selected.length);
    this.onSelectionChanged?.(selected);
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
    this.unsubscribeDisplayFilter();
    this.labelRenderer.dispose();
    this.snapGlyph?.remove();
    this.renderer.dispose();
    this.onMouseMove = null;
    this.onSelectionChanged = null;
    this.onOperationStatusChanged = null;
    this.onSnapChanged = null;
    this.onWorkPlaneUnavailable = null;
    this.canvas.title = this.originalCanvasTitle;
    delete this.canvas.dataset.snapKind;
    delete this.canvas.dataset.workPlaneError;
    delete this.canvas.dataset.selectedCount;
    delete this.canvas.dataset.operationStatus;
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
      this.renderLabels();
      // snap glyphはDOM overlayなので、カメラ操作・標準ビュー切替・resizeでも再投影する。
      this.updateSnapGlyph(this._currentSnapResult);
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
      showAllLayers: this.cameraCtrl.standardView === 'front' || this.cameraCtrl.standardView === 'right',
      cameraDistance: this.cameraCtrl.cameraDistance,
      cameraCenter: this.cameraCtrl.cameraCenter,
      layerZ: this.layerZ,
      showGrid: this._showGrid,
      gridWidth: this._gridWidth,
      gridBounds: this.cameraCtrl.getGridBounds(this.layerZ, rect),
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
    };
  }

  private renderLabels(): void {
    if (!Object.values(this.displayLabels.settings).some(Boolean)) {
      this.labelRenderer.clear();
      return;
    }
    const document = Document.instance;
    const visible = document.allDataList.filter((data) => {
      if (!this.displayFilter.allows(data) || !document.isDataVisible(data)) return false;
      const elevationView = this.cameraCtrl.standardView === 'front' || this.cameraCtrl.standardView === 'right';
      return this.show3D || elevationView || !document.shownLayer || data.existsOn(document.shownLayer);
    });
    const descriptors = createDisplayLabelDescriptors(
      visible,
      document.layers.filter((layer) => layer.visible),
      this.displayLabels.settings,
    );
    const rect = this.canvas.getBoundingClientRect();
    this.labelRenderer.render(descriptors, (point) => {
      const screen = this.cameraCtrl.worldToScreen(point, rect);
      return screen ? { x: screen.x - rect.left, y: screen.y - rect.top } : null;
    });
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
    const candidateKind = getObjectSnapCandidateKind(result);
    this.canvas.dataset.snapKind = candidateKind;
    this.updateSnapGlyph(result);
    if (changed) this.onSnapChanged?.(this.currentSnapResult);
  }

  private clearSnapCandidates(): void {
    this.lastSnapCandidates = [];
    this.selectedSnapCandidateId = null;
  }

  private resetCurrentSnap(): void {
    this.clearSnapCandidates();
    this.updateCurrentSnap(createUnsnappedResult(this._mouseWorldPos, this.layerZ));
  }

  private updateSnapGlyph(result: ObjectSnapResult): void {
    if (!this.snapGlyph) return;
    const kind = getObjectSnapCandidateKind(result);
    if (kind === 'none') {
      this.snapGlyph.hidden = true;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const screen = this.cameraCtrl.worldToScreen(result.position, rect);
    if (!screen) {
      this.snapGlyph.hidden = true;
      return;
    }
    const info = getObjectSnapKindInfo(kind);
    this.snapGlyph.hidden = false;
    this.snapGlyph.dataset.kind = kind;
    this.snapGlyph.dataset.glyph = info.glyph;
    this.snapGlyph.textContent = glyphText(info.glyph);
    this.snapGlyph.title = info.label;
    this.snapGlyph.style.left = `${screen.x - rect.left}px`;
    this.snapGlyph.style.top = `${screen.y - rect.top}px`;
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
  return (
    getObjectSnapCandidateKind(a) === getObjectSnapCandidateKind(b) &&
    a.candidateId === b.candidateId &&
    sameSnapSource(a.source, b.source) &&
    a.position.equals(b.position)
  );
}

function sameSnapSource(a: ObjectSnapResult['source'], b: ObjectSnapResult['source']): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a[0] === b[0] && a[1] === b[1];
}

function hitPriority(data: DocumentData): number {
  if (data.kind === 'support') return 0;
  if (data.kind === 'constraint') return 1;
  if (data.kind === 'node') return 2;
  if (data.kind === 'beam' || data.kind === 'pillar' || data.kind === 'truss' || data.kind === 'spring') return 3;
  return 4;
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

function toVector3(point: Point3D): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function constraintKinds(mode: 'all' | 'axis' | 'orthogonal'): ObjectSnapConstraintKind[] {
  if (mode === 'axis') return ['axis-x', 'axis-y', 'horizontal', 'vertical'];
  if (mode === 'orthogonal') return ['orthogonal'];
  return ['axis-x', 'axis-y', 'horizontal', 'vertical', 'orthogonal'];
}

function glyphText(glyph: ReturnType<typeof getObjectSnapKindInfo>['glyph']): string {
  const glyphs = {
    none: '',
    'node-circle': '○',
    'endpoint-square': '□',
    'midpoint-triangle': '△',
    'intersection-cross': '×',
    'grid-cross': '+',
    'horizontal-line': '—',
    'vertical-line': '│',
    'x-axis': 'X',
    'y-axis': 'Y',
    'right-angle': '∟',
  } as const;
  return glyphs[glyph];
}
