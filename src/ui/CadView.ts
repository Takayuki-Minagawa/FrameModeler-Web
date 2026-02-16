import * as THREE from 'three';
import { Document } from '../data/Document';
import { DocumentData } from '../data/DocumentData';
import { Node } from '../data/Node';
import { Member } from '../data/Member';
import { Beam } from '../data/Beam';
import { Pillar } from '../data/Pillar';
import { Plane } from '../data/Plane';
import { Floor, FloorDirection } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Point3D } from '../math/Point3D';
import { Point2D } from '../math/Point2D';
import { Layer } from './Layer';
import type { ICadMouseHandler } from './handlers/ICadMouseHandler';
import type { SelectionHandler } from './handlers/SelectionHandler';

export class CadView {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private perspCamera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;

  // カメラ制御
  private _show3D = false;
  private _showGrid = true;
  private _gridWidth = 100;
  private _snapWidth = 10;
  private _snapping = true;
  private cameraCenter = new THREE.Vector3(0, 0, 0);
  private cameraDistance = 2000;

  // ドラッグ状態
  private isDragging = false;
  private dragButton = -1;
  private dragStart = new THREE.Vector2();
  private dragPrev = new THREE.Vector2();

  // 球面座標 (3D視点用)
  private spherePhi = Math.PI / 4;
  private sphereTheta = Math.PI / 4;

  // Three.jsオブジェクトグループ
  private gridGroup = new THREE.Group();
  private elementGroup = new THREE.Group();
  private previewGroup = new THREE.Group();

  // マウスワールド座標
  private _mouseWorldPos = new Point3D();

  // ダブルクリック検出
  private lastClickTime = 0;
  private lastClickPos = new THREE.Vector2();

  // マウスハンドラ
  private _handler: ICadMouseHandler | null = null;

  // コールバック
  onMouseMove: ((pos: Point3D) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // レンダラー
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0xffffff);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // シーン
    this.scene = new THREE.Scene();

    // カメラ
    this.orthoCamera = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, 1, 1000000);
    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 10, 1000000);
    this.camera = this.orthoCamera;

    // Z-up設定
    this.orthoCamera.up.set(0, 0, 1);
    this.perspCamera.up.set(0, 0, 1);

    // グループ追加
    this.scene.add(this.gridGroup);
    this.scene.add(this.elementGroup);
    this.scene.add(this.previewGroup);

    // 初期カメラ位置(2D: Z方向から見下ろし)
    this.updateCamera();

    // イベント
    this.canvas.addEventListener('mousedown', this.onCanvasMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onCanvasMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onCanvasMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onCanvasWheel.bind(this));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.resize());

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

  get show3D(): boolean { return this._show3D; }
  set show3D(value: boolean) {
    if (this._show3D === value) return;
    this._show3D = value;
    this.camera = value ? this.perspCamera : this.orthoCamera;
    this.updateCamera();
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

    // Orthoカメラ更新
    const aspect = w / h;
    const halfH = this.cameraDistance;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();

    // Perspカメラ更新
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    this.render();
  }

  // ========== カメラ更新 ==========

  private updateCamera(): void {
    if (this._show3D) {
      const r = this.cameraDistance;
      const x = r * Math.sin(this.sphereTheta) * Math.cos(this.spherePhi);
      const y = r * Math.sin(this.sphereTheta) * Math.sin(this.spherePhi);
      const z = r * Math.cos(this.sphereTheta);
      this.perspCamera.position.set(
        this.cameraCenter.x + x,
        this.cameraCenter.y + y,
        this.cameraCenter.z + z
      );
      this.perspCamera.lookAt(this.cameraCenter);
      this.perspCamera.updateProjectionMatrix();
    } else {
      this.orthoCamera.position.set(
        this.cameraCenter.x,
        this.cameraCenter.y,
        this.cameraCenter.z + this.cameraDistance
      );
      this.orthoCamera.lookAt(this.cameraCenter);

      const container = this.canvas.parentElement!;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const aspect = w / h;
      const halfH = this.cameraDistance;
      this.orthoCamera.left = -halfH * aspect;
      this.orthoCamera.right = halfH * aspect;
      this.orthoCamera.top = halfH;
      this.orthoCamera.bottom = -halfH;
      this.orthoCamera.up.set(0, 1, 0);
      this.orthoCamera.updateProjectionMatrix();
    }
  }

  /** シーン中心にカメラを合わせる */
  fitToScene(): void {
    const center = Document.instance.sceneCenter;
    this.cameraCenter.set(center.x, center.y, center.z);
    this.updateCamera();
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
    const doc = Document.instance;
    snapped.z = doc.shownLayer?.posZ ?? 0;
    return snapped;
  }

  // ========== マウス→ワールド座標変換 ==========

  screenToWorld(screenX: number, screenY: number): Point3D {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

    const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
    ndc.unproject(this.camera);

    if (!this._show3D) {
      const doc = Document.instance;
      const layerZ = doc.shownLayer?.posZ ?? 0;
      return new Point3D(ndc.x, ndc.y, layerZ);
    } else {
      const doc = Document.instance;
      const layerZ = doc.shownLayer?.posZ ?? 0;
      const camPos = this.camera.position.clone();
      const dir = ndc.sub(camPos).normalize();
      if (Math.abs(dir.z) < 0.0001) return new Point3D(ndc.x, ndc.y, layerZ);
      const t = (layerZ - camPos.z) / dir.z;
      return new Point3D(camPos.x + dir.x * t, camPos.y + dir.y * t, layerZ);
    }
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
    const showAll = this._show3D || !layer;
    const hitRange = this.cameraDistance * 0.008; // ピクセル相当の距離

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

  // ========== マウスイベント ==========

  private onCanvasMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.dragButton = e.button;
    this.dragStart.set(e.clientX, e.clientY);
    this.dragPrev.set(e.clientX, e.clientY);

    if (e.button === 0 && this._handler) {
      const pos = this.getMouseCoord(e);

      // ダブルクリック検出
      const now = Date.now();
      const dx = e.clientX - this.lastClickPos.x;
      const dy = e.clientY - this.lastClickPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (now - this.lastClickTime < 400 && dist < 10) {
        this._handler.onDoubleClick(this, pos, e);
        this.lastClickTime = 0;
      } else {
        this._handler.onClick(this, pos, e);
        this.lastClickTime = now;
        this.lastClickPos.set(e.clientX, e.clientY);
      }
    }
  }

  private onCanvasMouseMove(e: MouseEvent): void {
    const worldPos = this.getMouseCoord(e);
    this._mouseWorldPos = worldPos;
    this.onMouseMove?.(worldPos);

    if (this._handler) {
      this._handler.onMouseMove(this, worldPos);
    }

    if (this.isDragging) {
      const dx = e.clientX - this.dragPrev.x;
      const dy = e.clientY - this.dragPrev.y;

      if (this.dragButton === 2 || this.dragButton === 1) {
        if (this._show3D && this.dragButton === 2) {
          this.spherePhi -= dx * 0.01;
          this.sphereTheta += dy * 0.01;
          this.sphereTheta = Math.max(0.01, Math.min(Math.PI - 0.01, this.sphereTheta));
        } else {
          const scale = this.cameraDistance / 500;
          this.cameraCenter.x -= dx * scale;
          this.cameraCenter.y += dy * scale;
        }
        this.updateCamera();
        this.render();
      }

      this.dragPrev.set(e.clientX, e.clientY);
    }
  }

  private onCanvasMouseUp(e: MouseEvent): void {
    if (this.isDragging && this.dragButton === 0 && this._handler) {
      // 左ドラッグ終了 → SelectionHandler用
      const pos = this.getMouseCoord(e);
      const sel = this._handler as any;
      if (typeof sel.onEndDrag === 'function') {
        sel.onEndDrag(this, pos, e);
      }
    }
    this.isDragging = false;
    this.dragButton = -1;
  }

  private onCanvasWheel(e: WheelEvent): void {
    e.preventDefault();
    const ratio = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    this.cameraDistance *= ratio;
    this.cameraDistance = Math.max(10, Math.min(100000, this.cameraDistance));
    this.updateCamera();
    this.render();
  }

  // ========== 描画 ==========

  render(): void {
    this.rebuildScene();
    this.renderer.render(this.scene, this.camera);
  }

  private rebuildScene(): void {
    this.clearGroup(this.gridGroup);
    this.clearGroup(this.elementGroup);

    if (this._showGrid) {
      this.drawGrid();
    }

    this.drawElements();
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
  }

  clearPreview(): void {
    this.clearGroup(this.previewGroup);
  }

  addPreviewLine(from: Point3D, to: Point3D, color: number = 0xff0000): void {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    this.previewGroup.add(new THREE.Line(geom, mat));
  }

  addPreviewPoint(pos: Point3D, color: number = 0xff0000): void {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pos.x, pos.y, pos.z),
    ]);
    const mat = new THREE.PointsMaterial({ color, size: 8, sizeAttenuation: false });
    this.previewGroup.add(new THREE.Points(geom, mat));
  }

  // ========== グリッド描画 ==========

  private drawGrid(): void {
    const doc = Document.instance;
    const layerZ = doc.shownLayer?.posZ ?? 0;
    const range = this.cameraDistance * 2;
    const gw = this._gridWidth;

    const gridPoints: THREE.Vector3[] = [];
    for (let x = -range; x <= range; x += gw) {
      gridPoints.push(new THREE.Vector3(x, -range, layerZ));
      gridPoints.push(new THREE.Vector3(x, range, layerZ));
    }
    for (let y = -range; y <= range; y += gw) {
      gridPoints.push(new THREE.Vector3(-range, y, layerZ));
      gridPoints.push(new THREE.Vector3(range, y, layerZ));
    }
    if (gridPoints.length > 0) {
      const geom = new THREE.BufferGeometry().setFromPoints(gridPoints);
      const mat = new THREE.LineBasicMaterial({ color: 0xa0a0a0, transparent: true, opacity: 0.5 });
      this.gridGroup.add(new THREE.LineSegments(geom, mat));
    }

    this.addLineToGroup(this.gridGroup, new THREE.Vector3(-range, 0, layerZ), new THREE.Vector3(range, 0, layerZ), 0xff0000);
    this.addLineToGroup(this.gridGroup, new THREE.Vector3(0, -range, layerZ), new THREE.Vector3(0, range, layerZ), 0x00aa00);
  }

  private addLineToGroup(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color });
    group.add(new THREE.Line(geom, mat));
  }

  // ========== 要素描画 ==========

  private drawElements(): void {
    const doc = Document.instance;
    const showAll = this._show3D || !doc.shownLayer;

    for (const node of doc.nodeList) {
      if (!showAll && !node.existsOn(doc.shownLayer)) continue;
      const isOnLayer = node.existsOn(doc.shownLayer);
      const color = node.select ? 0xff0000 : 0x0000ff;
      const opacity = isOnLayer ? 1.0 : 0.3;
      this.drawNode(node, color, opacity);
    }

    for (const member of doc.memberList) {
      if (!member.ok) continue;
      if (!showAll && !member.existsOn(doc.shownLayer)) continue;
      const isOnLayer = member.existsOn(doc.shownLayer);
      const color = member.select ? 0xff0000 : 0x0000ff;
      const opacity = isOnLayer ? 1.0 : 0.3;

      if (member instanceof Pillar && !this._show3D) {
        this.drawPillarCircle(member, color, opacity);
      } else {
        this.drawMemberLine(member, color, opacity);
      }
    }

    for (const plane of doc.planeList) {
      if (!plane.ok) continue;
      if (!showAll && !plane.existsOn(doc.shownLayer)) continue;
      const isOnLayer = plane.existsOn(doc.shownLayer);

      if (plane instanceof Floor) {
        if (plane.direction === FloorDirection.DUMMY) continue;
        const color = plane.select ? 0xff0000 : 0x0000ff;
        this.drawFloor(plane, color, isOnLayer ? 0.3 : 0.15);
      } else if (plane instanceof Wall) {
        const color = plane.select ? 0xff0000 : 0x00aa00;
        this.drawPlanePolygon(plane, color, isOnLayer ? 0.15 : 0.08);
      } else if (plane instanceof BearWall) {
        const color = plane.select ? 0xff0000 : 0x0000ff;
        this.drawPlanePolygon(plane, color, isOnLayer ? 0.3 : 0.15);
        this.drawBraces(plane, color, isOnLayer ? 1.0 : 0.5);
      }
    }
  }

  private drawNode(node: Node, color: number, opacity: number): void {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(node.pos.x, node.pos.y, node.pos.z),
    ]);
    const mat = new THREE.PointsMaterial({
      color, size: 6, sizeAttenuation: false,
      transparent: opacity < 1, opacity,
    });
    this.elementGroup.add(new THREE.Points(geom, mat));
  }

  private drawMemberLine(member: Member, color: number, opacity: number): void {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(member.posI.x, member.posI.y, member.posI.z),
      new THREE.Vector3(member.posJ.x, member.posJ.y, member.posJ.z),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color, linewidth: 2,
      transparent: opacity < 1, opacity,
    });
    this.elementGroup.add(new THREE.Line(geom, mat));
  }

  private drawPillarCircle(pillar: Pillar, color: number, opacity: number): void {
    const pos = pillar.nodeI!.pos;
    const radius = this.cameraDistance * 0.005;
    const geom = new THREE.CircleGeometry(radius, 32);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: opacity * 0.5,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.elementGroup.add(mesh);
  }

  private drawFloor(floor: Floor, color: number, opacity: number): void {
    this.drawPlanePolygon(floor, color, opacity);
  }

  private drawPlanePolygon(plane: Plane, color: number, opacity: number): void {
    const nodes = plane.nodeList;
    if (nodes.length < 3) return;

    const vertices: number[] = [];
    for (const n of nodes) {
      vertices.push(n.pos.x, n.pos.y, n.pos.z);
    }

    const indices: number[] = [];
    for (let i = 1; i < nodes.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      side: THREE.DoubleSide,
    });
    this.elementGroup.add(new THREE.Mesh(geom, mat));

    const edgePoints: THREE.Vector3[] = [];
    for (const n of nodes) {
      edgePoints.push(new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z));
    }
    edgePoints.push(edgePoints[0].clone());
    const lineGeom = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 2 });
    this.elementGroup.add(new THREE.Line(lineGeom, lineMat));
  }

  private drawBraces(bearWall: BearWall, color: number, opacity: number): void {
    const nodes = bearWall.nodeList;
    if (nodes.length < 4) return;

    for (let i = 0; i < 2; i++) {
      const j = i + 2;
      if (j >= nodes.length) break;
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(nodes[i].pos.x, nodes[i].pos.y, nodes[i].pos.z),
        new THREE.Vector3(nodes[j].pos.x, nodes[j].pos.y, nodes[j].pos.z),
      ]);
      const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
      this.elementGroup.add(new THREE.Line(geom, mat));
    }
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
