import * as THREE from 'three';
import { Document } from '../data/Document';
import { DocumentData } from '../data/DocumentData';
import { Node } from '../data/Node';
import { Member } from '../data/Member';
import { Pillar } from '../data/Pillar';
import { Plane } from '../data/Plane';
import { Floor, FloorDirection } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Point3D } from '../math/Point3D';
import { CAD, type CadPalette } from './CadConfig';
import type { CameraController, GridBounds } from './CameraController';

export interface RenderContext {
  palette: CadPalette;
  show3D: boolean;
  cameraDistance: number;
  cameraCenter: Readonly<THREE.Vector3>;
  layerZ: number;
  showGrid: boolean;
  gridWidth: number;
  gridBounds: GridBounds;
}

export interface MappedIntersection {
  intersection: THREE.Intersection;
  data: DocumentData;
}

type SelectionUpdater = (ctx: RenderContext) => void;

/**
 * Three.jsシーンの所有者。grid/elements/previewを個別に更新し、描画Objectと
 * DocumentDataの対応もここで一元管理する。
 */
export class CadRenderer {
  private readonly gridGroup = new THREE.Group();
  private readonly elementGroup = new THREE.Group();
  private readonly previewGroup = new THREE.Group();
  private objectData = new WeakMap<THREE.Object3D, ReadonlyArray<DocumentData>>();
  private selectionUpdaters: SelectionUpdater[] = [];
  private disposed = false;

  // previewは毎mousemoveでObjectを作り直さず、動的attributeとdrawRangeだけを更新する。
  private readonly previewLineGeometry = new THREE.BufferGeometry();
  private readonly previewPointGeometry = new THREE.BufferGeometry();
  private readonly previewLineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
  });
  private readonly previewPointMaterial = new THREE.PointsMaterial({
    vertexColors: true,
    size: CAD.PREVIEW_POINT_SIZE,
    sizeAttenuation: false,
  });
  private readonly previewLines: THREE.LineSegments;
  private readonly previewPoints: THREE.Points;
  private previewLinePositions = new Float32Array(6 * 8);
  private previewLineColors = new Float32Array(6 * 8);
  private previewPointPositions = new Float32Array(3 * 4);
  private previewPointColors = new Float32Array(3 * 4);
  private previewLineVertexCount = 0;
  private previewPointVertexCount = 0;

  constructor(scene: THREE.Scene) {
    this.gridGroup.name = 'cad-grid';
    this.elementGroup.name = 'cad-elements';
    this.previewGroup.name = 'cad-preview';
    scene.add(this.gridGroup, this.elementGroup, this.previewGroup);

    this.previewLines = new THREE.LineSegments(this.previewLineGeometry, this.previewLineMaterial);
    this.previewPoints = new THREE.Points(this.previewPointGeometry, this.previewPointMaterial);
    this.installPreviewLineAttributes();
    this.installPreviewPointAttributes();
    this.previewLineGeometry.setDrawRange(0, 0);
    this.previewPointGeometry.setDrawRange(0, 0);
    this.previewGroup.add(this.previewLines, this.previewPoints);
  }

  /** 従来互換: gridとelementsを再構築する。 */
  rebuild(ctx: RenderContext): void {
    this.rebuildGrid(ctx);
    this.rebuildElements(ctx);
  }

  rebuildGrid(ctx: RenderContext): void {
    this.clearGroup(this.gridGroup);
    if (ctx.showGrid) this.drawGrid(ctx);
  }

  rebuildElements(ctx: RenderContext): void {
    this.clearGroup(this.elementGroup);
    this.objectData = new WeakMap();
    this.selectionUpdaters = [];
    this.drawElements(ctx);
  }

  /** geometryを作り直さず、選択/レイヤー状態に応じたcolorとopacityだけ更新する。 */
  updateSelection(ctx: RenderContext): void {
    for (const update of this.selectionUpdaters) update(ctx);
  }

  clearPreview(): void {
    this.previewLineVertexCount = 0;
    this.previewPointVertexCount = 0;
    this.previewLineGeometry.setDrawRange(0, 0);
    this.previewPointGeometry.setDrawRange(0, 0);
  }

  addPreviewLine(from: Point3D, to: Point3D, color: number): void {
    this.ensurePreviewLineCapacity(this.previewLineVertexCount + 2);
    this.writePreviewVertex(
      this.previewLinePositions,
      this.previewLineColors,
      this.previewLineVertexCount++,
      from,
      color,
    );
    this.writePreviewVertex(
      this.previewLinePositions,
      this.previewLineColors,
      this.previewLineVertexCount++,
      to,
      color,
    );
    this.markPreviewLinesChanged();
  }

  addPreviewPoint(pos: Point3D, color: number): void {
    this.ensurePreviewPointCapacity(this.previewPointVertexCount + 1);
    this.writePreviewVertex(
      this.previewPointPositions,
      this.previewPointColors,
      this.previewPointVertexCount++,
      pos,
      color,
    );
    this.markPreviewPointsChanged();
  }

  addPreviewPolygon(points: Point3D[], color: number): void {
    this.ensurePreviewLineCapacity(this.previewLineVertexCount + points.length * 2);
    for (let i = 0; i < points.length; i++) {
      const next = points[(i + 1) % points.length];
      this.writePreviewVertex(
        this.previewLinePositions,
        this.previewLineColors,
        this.previewLineVertexCount++,
        points[i],
        color,
      );
      this.writePreviewVertex(
        this.previewLinePositions,
        this.previewLineColors,
        this.previewLineVertexCount++,
        next,
        color,
      );
    }
    this.markPreviewLinesChanged();
  }

  /** elementGroupだけをRaycasterへ渡し、intersection.indexをDataへ解決する。 */
  raycast(raycaster: THREE.Raycaster): MappedIntersection[] {
    this.elementGroup.updateMatrixWorld(true);
    const intersections = raycaster.intersectObjects(this.elementGroup.children, true);
    const mapped: MappedIntersection[] = [];
    for (const intersection of intersections) {
      const data = this.getMappedData(intersection.object, intersection.index);
      if (data) mapped.push({ intersection, data });
    }
    return mapped;
  }

  /** Object3D/primitive indexから元DocumentDataを引く（テスト・拡張用にも公開）。 */
  getMappedData(object: THREE.Object3D, primitiveIndex?: number): DocumentData | null {
    const list = this.objectData.get(object);
    if (!list || list.length === 0) return null;
    if (list.length === 1) return list[0];

    if (object instanceof THREE.Points) {
      return list[Math.max(0, primitiveIndex ?? 0)] ?? null;
    }
    if (object instanceof THREE.LineSegments) {
      return list[Math.floor(Math.max(0, primitiveIndex ?? 0) / 2)] ?? null;
    }
    return list[0];
  }

  /** 平面図専用のscreen-space hit。鉛直面は投影輪郭線として判定する。 */
  hitTest2D(
    screenX: number,
    screenY: number,
    camera: CameraController,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    tolerancePx = CAD.HIT_TOLERANCE_PX,
  ): DocumentData | null {
    const doc = Document.instance;
    const layer = doc.shownLayer;
    const pointer = new THREE.Vector2(screenX, screenY);
    const isVisible = (data: DocumentData): boolean => !layer || data.existsOn(layer);

    let closestNode: { data: Node; distance: number } | null = null;
    for (const node of doc.nodeList) {
      if (!isVisible(node)) continue;
      const projected = camera.worldToScreen(node.pos, rect);
      if (!projected) continue;
      const distance = projected.distanceTo(pointer);
      if (distance <= tolerancePx && (!closestNode || distance < closestNode.distance)) {
        closestNode = { data: node, distance };
      }
    }
    if (closestNode) return closestNode.data;

    let closestMember: { data: Member; distance: number } | null = null;
    for (const member of doc.memberList) {
      if (!member.ok || !isVisible(member)) continue;
      const a = camera.worldToScreen(member.posI, rect);
      const b = camera.worldToScreen(member.posJ, rect);
      if (!a || !b) continue;
      const distance = distanceToSegment(pointer, a, b);
      if (distance <= tolerancePx && (!closestMember || distance < closestMember.distance)) {
        closestMember = { data: member, distance };
      }
    }
    if (closestMember) return closestMember.data;

    let closestPlane: { data: Plane; distance: number } | null = null;
    for (const plane of doc.planeList) {
      if (!plane.ok || !isVisible(plane)) continue;
      const vertices = plane.nodeList
        .map((node) => camera.worldToScreen(node.pos, rect))
        .filter((point): point is THREE.Vector2 => point !== null);
      if (vertices.length < 2) continue;

      let distance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < vertices.length; i++) {
        distance = Math.min(distance, distanceToSegment(pointer, vertices[i], vertices[(i + 1) % vertices.length]));
      }
      // 床など面積を持つ投影は内部もhit。鉛直壁は面積0でも輪郭線距離でhitする。
      if (vertices.length >= 3 && Math.abs(polygonSignedArea(vertices)) > 1e-6 && isInsidePolygon(pointer, vertices)) {
        distance = 0;
      }
      if (distance <= tolerancePx && (!closestPlane || distance < closestPlane.distance)) {
        closestPlane = { data: plane, distance };
      }
    }
    return closestPlane?.data ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearGroup(this.gridGroup);
    this.clearGroup(this.elementGroup);

    this.previewGroup.remove(this.previewLines, this.previewPoints);
    this.previewLineGeometry.dispose();
    this.previewPointGeometry.dispose();
    this.previewLineMaterial.dispose();
    this.previewPointMaterial.dispose();
    this.gridGroup.parent?.remove(this.gridGroup);
    this.elementGroup.parent?.remove(this.elementGroup);
    this.previewGroup.parent?.remove(this.previewGroup);
    this.selectionUpdaters = [];
    this.objectData = new WeakMap();
  }

  // ========== grid ==========

  private drawGrid(ctx: RenderContext): void {
    const bounds = alignedGridBounds(ctx.gridBounds, ctx.gridWidth);
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const step = chooseGridStep(ctx.gridWidth, span);
    const minX = Math.floor(bounds.minX / step) * step;
    const maxX = Math.ceil(bounds.maxX / step) * step;
    const minY = Math.floor(bounds.minY / step) * step;
    const maxY = Math.ceil(bounds.maxY / step) * step;
    const z = ctx.layerZ;

    const points: THREE.Vector3[] = [];
    for (let x = minX; x <= maxX + step * 1e-6; x += step) {
      points.push(new THREE.Vector3(x, minY, z), new THREE.Vector3(x, maxY, z));
    }
    for (let y = minY; y <= maxY + step * 1e-6; y += step) {
      points.push(new THREE.Vector3(minX, y, z), new THREE.Vector3(maxX, y, z));
    }
    if (points.length > 0) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: ctx.palette.grid, transparent: true, opacity: 0.5 });
      this.gridGroup.add(new THREE.LineSegments(geometry, material));
    }

    if (minY <= 0 && maxY >= 0) {
      this.addGridAxis(new THREE.Vector3(minX, 0, z), new THREE.Vector3(maxX, 0, z), ctx.palette.axisX);
    }
    if (minX <= 0 && maxX >= 0) {
      this.addGridAxis(new THREE.Vector3(0, minY, z), new THREE.Vector3(0, maxY, z), ctx.palette.axisY);
    }
  }

  private addGridAxis(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    const material = new THREE.LineBasicMaterial({ color });
    this.gridGroup.add(new THREE.Line(geometry, material));
  }

  // ========== elements ==========

  private drawElements(ctx: RenderContext): void {
    const doc = Document.instance;
    const showAll = ctx.show3D || !doc.shownLayer;
    const nodes = doc.nodeList.filter((node) => showAll || node.existsOn(doc.shownLayer));
    const members = doc.memberList.filter((member) => member.ok && (showAll || member.existsOn(doc.shownLayer)));

    this.drawNodeBatch(nodes, ctx);
    this.drawMemberBatch(members, ctx);
    if (!ctx.show3D)
      this.drawPillarBatch(
        members.filter((m): m is Pillar => m instanceof Pillar),
        ctx,
      );

    for (const plane of doc.planeList) {
      if (!plane.ok || (!showAll && !plane.existsOn(doc.shownLayer))) continue;
      if (plane instanceof Floor && plane.direction === FloorDirection.DUMMY) continue;
      this.drawPlane(plane, ctx);
    }
  }

  private drawNodeBatch(nodes: Node[], ctx: RenderContext): void {
    if (nodes.length === 0) return;
    const positions: number[] = [];
    for (const node of nodes) positions.push(node.pos.x, node.pos.y, node.pos.z);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nodes.length * 3), 3));
    const material = new THREE.PointsMaterial({
      size: CAD.NODE_SIZE,
      sizeAttenuation: false,
      vertexColors: true,
    });
    const points = new THREE.Points(geometry, material);
    this.mapObject(points, nodes);
    this.elementGroup.add(points);

    const update: SelectionUpdater = (state) => {
      const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
      nodes.forEach((node, index) => colors.setXYZ(index, ...this.colorTuple(node, state.palette.node, state)));
      colors.needsUpdate = true;
    };
    this.selectionUpdaters.push(update);
    update(ctx);
  }

  private drawMemberBatch(members: Member[], ctx: RenderContext): void {
    if (members.length === 0) return;
    const positions: number[] = [];
    for (const member of members) {
      positions.push(member.posI.x, member.posI.y, member.posI.z, member.posJ.x, member.posJ.y, member.posJ.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(members.length * 6), 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true });
    const lines = new THREE.LineSegments(geometry, material);
    this.mapObject(lines, members);
    this.elementGroup.add(lines);

    const update: SelectionUpdater = (state) => {
      const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
      members.forEach((member, index) => {
        const tuple = this.colorTuple(member, state.palette.member, state);
        colors.setXYZ(index * 2, ...tuple);
        colors.setXYZ(index * 2 + 1, ...tuple);
      });
      colors.needsUpdate = true;
    };
    this.selectionUpdaters.push(update);
    update(ctx);
  }

  private drawPillarBatch(pillars: Pillar[], ctx: RenderContext): void {
    if (pillars.length === 0) return;
    const positions: number[] = [];
    for (const pillar of pillars) positions.push(pillar.posI.x, pillar.posI.y, pillar.posI.z);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pillars.length * 3), 3));
    const material = new THREE.PointsMaterial({
      size: Math.max(CAD.NODE_SIZE + 4, 10),
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
    });
    const points = new THREE.Points(geometry, material);
    this.mapObject(points, pillars);
    this.elementGroup.add(points);

    const update: SelectionUpdater = (state) => {
      const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
      pillars.forEach((pillar, index) => colors.setXYZ(index, ...this.colorTuple(pillar, state.palette.member, state)));
      colors.needsUpdate = true;
    };
    this.selectionUpdaters.push(update);
    update(ctx);
  }

  private drawPlane(plane: Plane, ctx: RenderContext): void {
    const nodes = plane.nodeList;
    if (nodes.length < 3) return;
    const vertices: number[] = [];
    for (const node of nodes) vertices.push(node.pos.x, node.pos.y, node.pos.z);
    const indices: number[] = [];
    for (let i = 1; i < nodes.length - 1; i++) indices.push(0, i, i + 1);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.mapObject(mesh, [plane]);
    this.elementGroup.add(mesh);

    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(
      nodes.map((node) => new THREE.Vector3(node.pos.x, node.pos.y, node.pos.z)),
    );
    const edgeMaterial = new THREE.LineBasicMaterial({ transparent: true });
    const edge = new THREE.LineLoop(edgeGeometry, edgeMaterial);
    this.mapObject(edge, [plane]);
    this.elementGroup.add(edge);

    let braces: THREE.LineSegments | null = null;
    if (plane instanceof BearWall && nodes.length >= 4) {
      const braceGeometry = new THREE.BufferGeometry().setFromPoints([
        toVector(nodes[0].pos),
        toVector(nodes[2].pos),
        toVector(nodes[1].pos),
        toVector(nodes[3].pos),
      ]);
      const braceMaterial = new THREE.LineBasicMaterial({ transparent: true });
      braces = new THREE.LineSegments(braceGeometry, braceMaterial);
      this.mapObject(braces, [plane]);
      this.elementGroup.add(braces);
    }

    const update: SelectionUpdater = (state) => {
      const baseColor = plane instanceof Wall ? state.palette.wall : state.palette.member;
      const color = new THREE.Color(...this.colorTuple(plane, baseColor, state));
      const onLayer = !Document.instance.shownLayer || plane.existsOn(Document.instance.shownLayer);
      const baseOpacity = plane instanceof Wall ? 0.15 : 0.3;
      material.color.copy(color);
      material.opacity = onLayer ? baseOpacity : baseOpacity / 2;
      edgeMaterial.color.copy(color);
      edgeMaterial.opacity = onLayer ? Math.min(1, baseOpacity * 2) : baseOpacity;
      if (braces) {
        const braceMaterial = braces.material as THREE.LineBasicMaterial;
        braceMaterial.color.copy(color);
        braceMaterial.opacity = onLayer ? 1 : 0.5;
      }
    };
    this.selectionUpdaters.push(update);
    update(ctx);
  }

  private colorTuple(data: DocumentData, baseColor: number, ctx: RenderContext): [number, number, number] {
    const color = new THREE.Color(data.select ? ctx.palette.select : baseColor);
    const layer = Document.instance.shownLayer;
    if (layer && !data.existsOn(layer)) color.lerp(new THREE.Color(ctx.palette.background), 0.6);
    return [color.r, color.g, color.b];
  }

  private mapObject(object: THREE.Object3D, data: ReadonlyArray<DocumentData>): void {
    this.objectData.set(object, data);
  }

  // ========== preview buffers ==========

  private ensurePreviewLineCapacity(vertexCount: number): void {
    if (this.previewLinePositions.length >= vertexCount * 3) return;
    const length = growCapacity(this.previewLinePositions.length, vertexCount * 3);
    const positions = new Float32Array(length);
    const colors = new Float32Array(length);
    positions.set(this.previewLinePositions);
    colors.set(this.previewLineColors);
    this.previewLinePositions = positions;
    this.previewLineColors = colors;
    this.installPreviewLineAttributes();
  }

  private ensurePreviewPointCapacity(vertexCount: number): void {
    if (this.previewPointPositions.length >= vertexCount * 3) return;
    const length = growCapacity(this.previewPointPositions.length, vertexCount * 3);
    const positions = new Float32Array(length);
    const colors = new Float32Array(length);
    positions.set(this.previewPointPositions);
    colors.set(this.previewPointColors);
    this.previewPointPositions = positions;
    this.previewPointColors = colors;
    this.installPreviewPointAttributes();
  }

  private installPreviewLineAttributes(): void {
    this.previewLineGeometry.setAttribute('position', dynamicAttribute(this.previewLinePositions));
    this.previewLineGeometry.setAttribute('color', dynamicAttribute(this.previewLineColors));
  }

  private installPreviewPointAttributes(): void {
    this.previewPointGeometry.setAttribute('position', dynamicAttribute(this.previewPointPositions));
    this.previewPointGeometry.setAttribute('color', dynamicAttribute(this.previewPointColors));
  }

  private writePreviewVertex(
    positions: Float32Array,
    colors: Float32Array,
    index: number,
    point: Point3D,
    colorValue: number,
  ): void {
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
    const color = new THREE.Color(colorValue);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  private markPreviewLinesChanged(): void {
    (this.previewLineGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.previewLineGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.previewLineGeometry.setDrawRange(0, this.previewLineVertexCount);
    this.previewLineGeometry.computeBoundingSphere();
  }

  private markPreviewPointsChanged(): void {
    (this.previewPointGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.previewPointGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.previewPointGeometry.setDrawRange(0, this.previewPointVertexCount);
    this.previewPointGeometry.computeBoundingSphere();
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObjectTree(child);
    }
  }
}

/** 1/2/5/10系列でグリッドLODを選ぶ。 */
export function chooseGridStep(baseWidth: number, visibleSpan: number): number {
  const base = Math.max(Number.EPSILON, Math.abs(baseWidth));
  const requiredFactor = visibleSpan / (base * CAD.MAX_GRID_LINES);
  if (!Number.isFinite(requiredFactor) || requiredFactor <= 1) return base;
  const power = 10 ** Math.floor(Math.log10(requiredFactor));
  for (const multiplier of [1, 2, 5, 10]) {
    if (multiplier * power >= requiredFactor) return base * multiplier * power;
  }
  return base * 10 * power;
}

/** global grid原点へ揃えた表示範囲。 */
export function alignedGridBounds(bounds: GridBounds, gridWidth: number): GridBounds {
  const width = Math.max(Number.EPSILON, Math.abs(gridWidth));
  return {
    minX: Math.floor(bounds.minX / width) * width,
    maxX: Math.ceil(bounds.maxX / width) * width,
    minY: Math.floor(bounds.minY / width) * width,
    maxY: Math.ceil(bounds.maxY / width) * width,
  };
}

function dynamicAttribute(array: Float32Array): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage);
}

function growCapacity(current: number, needed: number): number {
  let capacity = Math.max(current, 3);
  while (capacity < needed) capacity *= 2;
  return capacity;
}

function toVector(point: Point3D): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function distanceToSegment(point: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const segment = b.clone().sub(a);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared === 0) return point.distanceTo(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(segment) / lengthSquared, 0, 1);
  return point.distanceTo(a.clone().addScaledVector(segment, t));
}

function polygonSignedArea(vertices: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    area += vertices[j].x * vertices[i].y - vertices[i].x * vertices[j].y;
  }
  return area / 2;
}

function isInsidePolygon(point: THREE.Vector2, vertices: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    renderable.geometry?.dispose();
    if (Array.isArray(renderable.material)) {
      renderable.material.forEach((material) => material.dispose());
    } else {
      renderable.material?.dispose();
    }
  });
}
