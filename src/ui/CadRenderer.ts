import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
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
import { DisplayFilter } from '../display/DisplayFilter';
import { Truss } from '../data/Truss';
import { Spring } from '../data/Spring';
import { Support } from '../data/Support';
import { Constraint } from '../data/Constraint';

export interface RenderContext {
  palette: CadPalette;
  show3D: boolean;
  /** 正面・側面など、平行投影でも全階を重ねて表示する標準ビュー。 */
  showAllLayers?: boolean;
  cameraDistance: number;
  cameraCenter: Readonly<THREE.Vector3>;
  layerZ: number;
  showGrid: boolean;
  gridWidth: number;
  gridBounds: GridBounds;
  /** 太線materialの初回raycastにも使う。未指定時はLineSegments2.onBeforeRenderが実viewportへ同期する。 */
  viewportWidth?: number;
  viewportHeight?: number;
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
  private readonly wideLineMaterials = new Set<LineMaterial>();
  private readonly viewportSize = new THREE.Vector2(1, 1);
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

  constructor(
    scene: THREE.Scene,
    readonly displayFilter: DisplayFilter = new DisplayFilter(),
  ) {
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
    this.updateViewportFromContext(ctx);
    this.clearGroup(this.gridGroup);
    if (ctx.showGrid) this.drawGrid(ctx);
  }

  rebuildElements(ctx: RenderContext): void {
    this.updateViewportFromContext(ctx);
    this.wideLineMaterials.clear();
    this.clearGroup(this.elementGroup);
    this.objectData = new WeakMap();
    this.selectionUpdaters = [];
    this.drawElements(ctx);
  }

  /** geometryを作り直さず、選択/レイヤー状態に応じたcolorとopacityだけ更新する。 */
  updateSelection(ctx: RenderContext): void {
    this.updateViewportFromContext(ctx);
    // selectedOnlyはselectの変化でbatch構成自体が変わるため、このモードだけ再構築する。
    if (this.displayFilter.mode === 'selectedOnly') {
      this.rebuildElements(ctx);
      return;
    }
    for (const update of this.selectionUpdaters) update(ctx);
  }

  /**
   * screen-space太線のresolutionを即時更新する。実描画時にもLineSegments2がviewportを再同期するため、
   * ResizeObserver経由のrenderと、render前のraycastの双方で正しい幅になる。
   */
  setViewportSize(width: number, height: number): void {
    this.viewportSize.set(safeViewportDimension(width), safeViewportDimension(height));
    for (const material of this.wideLineMaterials) material.resolution.copy(this.viewportSize);
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
      const data = this.getMappedData(intersection.object, intersection.faceIndex ?? intersection.index);
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
    if (object instanceof LineSegments2) {
      return list[Math.max(0, primitiveIndex ?? 0)] ?? null;
    }
    return list[0];
  }

  /** 平面図専用のscreen-space hit。鉛直面は投影輪郭線として判定する。 */
  hitTest2D(
    screenX: number,
    screenY: number,
    camera: CameraController,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    tolerancePx: number = CAD.HIT_TOLERANCE_PX,
    predicate: (data: DocumentData) => boolean = () => true,
    showAllLayers: boolean = false,
  ): DocumentData | null {
    const doc = Document.instance;
    const layer = doc.shownLayer;
    const pointer = new THREE.Vector2(screenX, screenY);
    const isVisible = (data: DocumentData): boolean =>
      this.displayFilter.allows(data) &&
      predicate(data) &&
      doc.isDataVisible(data) &&
      !doc.isDataLocked(data) &&
      (showAllLayers || !layer || data.existsOn(layer));

    let closestSupport: { data: Support; distance: number } | null = null;
    for (const support of doc.chooseData(Support)) {
      if (!support.node || !isVisible(support)) continue;
      const projected = camera.worldToScreen(support.node.pos, rect);
      if (!projected) continue;
      const distance = projected.distanceTo(pointer);
      if (distance <= tolerancePx * 1.5 && (!closestSupport || distance < closestSupport.distance)) {
        closestSupport = { data: support, distance };
      }
    }
    if (closestSupport) return closestSupport.data;

    let closestConstraint: { data: Constraint; distance: number } | null = null;
    for (const constraint of doc.chooseData(Constraint)) {
      if (!constraint.slaveNode || !isVisible(constraint)) continue;
      const slave = camera.worldToScreen(constraint.slaveNode.pos, rect);
      if (!slave) continue;
      for (const term of constraint.terms) {
        const master = camera.worldToScreen(term.node.pos, rect);
        if (!master) continue;
        const distance = distanceToSegment(pointer, slave, master);
        if (distance <= tolerancePx && (!closestConstraint || distance < closestConstraint.distance)) {
          closestConstraint = { data: constraint, distance };
        }
      }
    }
    if (closestConstraint) return closestConstraint.data;

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
      const path =
        member instanceof Spring
          ? springGlyphPoints(member.posI, member.posJ, camera.cameraDistance)
          : [member.posI, member.posJ];
      const projected = path.map((point) => camera.worldToScreen(point, rect));
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < projected.length - 1; index++) {
        const a = projected[index];
        const b = projected[index + 1];
        if (a && b) distance = Math.min(distance, distanceToSegment(pointer, a, b));
      }
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
    this.wideLineMaterials.clear();
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
    const showAll = ctx.show3D || ctx.showAllLayers === true || !doc.shownLayer;
    const nodes = doc.nodeList.filter(
      (node) =>
        this.displayFilter.allows(node) && doc.isDataVisible(node) && (showAll || node.existsOn(doc.shownLayer)),
    );
    const members = doc.memberList.filter(
      (member) =>
        member.ok &&
        this.displayFilter.allows(member) &&
        doc.isDataVisible(member) &&
        (showAll || member.existsOn(doc.shownLayer)),
    );
    const regularMembers = members.filter((member) => !(member instanceof Truss) && !(member instanceof Spring));
    const trusses = members.filter((member): member is Truss => member instanceof Truss);
    const springs = members.filter((member): member is Spring => member instanceof Spring);
    const supports = doc
      .chooseData(Support)
      .filter(
        (support) =>
          support.node &&
          this.displayFilter.allows(support) &&
          doc.isDataVisible(support) &&
          (showAll || support.existsOn(doc.shownLayer)),
      );
    const constraints = doc
      .chooseData(Constraint)
      .filter(
        (constraint) =>
          this.displayFilter.allows(constraint) &&
          doc.isDataVisible(constraint) &&
          (showAll || constraint.existsOn(doc.shownLayer)),
      );

    this.drawNodeBatch(nodes, ctx);
    this.drawMassBatch(
      nodes.filter((node) => node.mass !== null),
      ctx,
    );
    this.drawMemberBatch(regularMembers, ctx, 'member');
    this.drawMemberBatch(trusses, ctx, 'truss');
    this.drawTrussMarkers(trusses, ctx);
    this.drawSprings(springs, ctx);
    this.drawSupports(supports, ctx);
    this.drawConstraints(constraints, ctx);
    if (!ctx.show3D)
      this.drawPillarBatch(
        regularMembers.filter((m): m is Pillar => m instanceof Pillar),
        ctx,
      );

    for (const plane of doc.planeList) {
      if (!this.displayFilter.allows(plane) || !doc.isDataVisible(plane)) continue;
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

  private drawMemberBatch(members: Member[], ctx: RenderContext, colorKey: 'member' | 'truss' = 'member'): void {
    if (members.length === 0) return;
    const positions: number[] = [];
    for (const member of members) {
      positions.push(member.posI.x, member.posI.y, member.posI.z, member.posJ.x, member.posJ.y, member.posJ.z);
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(new Float32Array(members.length * 6));
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: CAD.MEMBER_LINEWIDTH,
      worldUnits: false,
      resolution: this.viewportSize.clone(),
    });
    this.wideLineMaterials.add(material);
    const lines = new LineSegments2(geometry, material);
    lines.renderOrder = 30;
    this.mapObject(lines, members);
    this.elementGroup.add(lines);

    const update: SelectionUpdater = (state) => {
      const starts = geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute;
      const ends = geometry.getAttribute('instanceColorEnd') as THREE.InterleavedBufferAttribute;
      members.forEach((member, index) => {
        const tuple = this.colorTuple(member, state.palette[colorKey], state);
        starts.setXYZ(index, ...tuple);
        ends.setXYZ(index, ...tuple);
      });
      starts.data.needsUpdate = true;
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

  private drawMassBatch(nodes: Node[], ctx: RenderContext): void {
    if (nodes.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        nodes.flatMap((node) => [node.pos.x, node.pos.y, node.pos.z]),
        3,
      ),
    );
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nodes.length * 3), 3));
    const material = new THREE.PointsMaterial({
      size: CAD.NODE_SIZE + 8,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
    });
    const points = new THREE.Points(geometry, material);
    this.mapObject(points, nodes);
    this.elementGroup.add(points);
    const update: SelectionUpdater = (state) => {
      const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
      nodes.forEach((node, index) => colors.setXYZ(index, ...this.colorTuple(node, state.palette.mass, state)));
      colors.needsUpdate = true;
    };
    this.selectionUpdaters.push(update);
    update(ctx);
  }

  private drawTrussMarkers(trusses: Truss[], ctx: RenderContext): void {
    if (trusses.length === 0) return;
    const positions: number[] = [];
    for (const truss of trusses) {
      const center = truss.posI.add(truss.posJ).div(2);
      positions.push(center.x, center.y, center.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(trusses.length * 3), 3));
    const material = new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true });
    const points = new THREE.Points(geometry, material);
    this.mapObject(points, trusses);
    this.elementGroup.add(points);
    const update: SelectionUpdater = (state) => {
      const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
      trusses.forEach((truss, index) => colors.setXYZ(index, ...this.colorTuple(truss, state.palette.truss, state)));
      colors.needsUpdate = true;
    };
    this.selectionUpdaters.push(update);
    update(ctx);
  }

  private drawSprings(springs: Spring[], ctx: RenderContext): void {
    for (const spring of springs) {
      const points = springGlyphPoints(spring.posI, spring.posJ, ctx.cameraDistance);
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(toVector));
      const material = new THREE.LineBasicMaterial({ depthTest: true });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 31;
      this.mapObject(line, [spring]);
      this.elementGroup.add(line);
      const update: SelectionUpdater = (state) => {
        material.color.set(spring.select ? state.palette.select : state.palette.spring);
      };
      this.selectionUpdaters.push(update);
      update(ctx);
    }
  }

  private drawSupports(supports: Support[], ctx: RenderContext): void {
    const size = Math.max(20, Math.min(ctx.cameraDistance * 0.025, 500));
    for (const support of supports) {
      if (!support.node) continue;
      const p = support.node.pos;
      const vertices = [
        new Point3D(p.x, p.y, p.z),
        new Point3D(p.x - size, p.y - size, p.z),
        new Point3D(p.x, p.y, p.z),
        new Point3D(p.x + size, p.y - size, p.z),
        new Point3D(p.x - size, p.y - size, p.z),
        new Point3D(p.x + size, p.y - size, p.z),
        new Point3D(p.x - size, p.y, p.z),
        new Point3D(p.x + size, p.y, p.z),
        new Point3D(p.x, p.y - size, p.z),
        new Point3D(p.x, p.y + size, p.z),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(vertices.map(toVector));
      const material = new THREE.LineBasicMaterial({ depthTest: true });
      const glyph = new THREE.LineSegments(geometry, material);
      glyph.renderOrder = 35;
      this.mapObject(glyph, [support]);
      this.elementGroup.add(glyph);
      const update: SelectionUpdater = (state) => {
        material.color.set(support.select ? state.palette.select : state.palette.support);
      };
      this.selectionUpdaters.push(update);
      update(ctx);
    }
  }

  private drawConstraints(constraints: Constraint[], ctx: RenderContext): void {
    for (const constraint of constraints) {
      if (!constraint.slaveNode || constraint.terms.length === 0) continue;
      const points: THREE.Vector3[] = [];
      for (const term of constraint.terms) {
        points.push(toVector(constraint.slaveNode.pos), toVector(term.node.pos));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({ dashSize: 30, gapSize: 20, depthTest: true });
      const lines = new THREE.LineSegments(geometry, material);
      lines.computeLineDistances();
      lines.renderOrder = 29;
      this.mapObject(lines, [constraint]);
      this.elementGroup.add(lines);
      const update: SelectionUpdater = (state) => {
        material.color.set(constraint.select ? state.palette.select : state.palette.constraint);
      };
      this.selectionUpdaters.push(update);
      update(ctx);
    }
  }

  private drawPlane(plane: Plane, ctx: RenderContext): void {
    const nodes = plane.nodeList;
    if (nodes.length < 3) return;
    const vertices: number[] = [];
    for (const node of nodes) vertices.push(node.pos.x, node.pos.y, node.pos.z);
    const indices = triangulatePolygon3D(nodes.map((node) => node.pos));
    if (indices.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10;
    this.mapObject(mesh, [plane]);
    this.elementGroup.add(mesh);

    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(
      nodes.map((node) => new THREE.Vector3(node.pos.x, node.pos.y, node.pos.z)),
    );
    const edgeMaterial = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, depthTest: true });
    const edge = new THREE.LineLoop(edgeGeometry, edgeMaterial);
    edge.renderOrder = 20;
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
      const braceMaterial = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, depthTest: true });
      braces = new THREE.LineSegments(braceGeometry, braceMaterial);
      braces.renderOrder = 21;
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

  private updateViewportFromContext(ctx: RenderContext): void {
    if (ctx.viewportWidth !== undefined && ctx.viewportHeight !== undefined) {
      this.setViewportSize(ctx.viewportWidth, ctx.viewportHeight);
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

/**
 * 任意方向の平面を局所直交座標へ投影し、Three.js(Earcut)で凹多角形も三角形分割する。
 * 戻り値は元points配列を参照するindex列。
 */
export function triangulatePolygon3D(points: ReadonlyArray<Point3D>): number[] {
  if (points.length < 3) return [];
  const normal = newellNormal(points);
  if (normal.length <= Number.EPSILON) return [];
  normal.normalize();

  const origin = points[0];
  let tangent: Point3D | null = null;
  for (let i = 1; i < points.length; i++) {
    const edge = points[i].sub(origin);
    const projected = edge.sub(normal.scale(Point3D.dotProduct(edge, normal)));
    if (projected.length > Number.EPSILON) {
      tangent = projected.getNormalized();
      break;
    }
  }
  if (!tangent) return [];
  const bitangent = Point3D.crossProduct(normal, tangent).getNormalized();
  const contour = points.map((point) => {
    const local = point.sub(origin);
    return new THREE.Vector2(Point3D.dotProduct(local, tangent), Point3D.dotProduct(local, bitangent));
  });
  return THREE.ShapeUtils.triangulateShape(contour, []).flat();
}

function dynamicAttribute(array: Float32Array): THREE.BufferAttribute {
  return new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage);
}

function newellNormal(points: ReadonlyArray<Point3D>): Point3D {
  const normal = new Point3D();
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }
  return normal;
}

function safeViewportDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function growCapacity(current: number, needed: number): number {
  let capacity = Math.max(current, 3);
  while (capacity < needed) capacity *= 2;
  return capacity;
}

function toVector(point: Point3D): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

/** ばねを端部直線＋中央のzig-zagで表す。零長ばねにも画面上で識別できるglyphを与える。 */
export function springGlyphPoints(from: Point3D, to: Point3D, cameraDistance: number): Point3D[] {
  const delta = to.sub(from);
  const actualLength = delta.length;
  const fallbackLength = Math.max(20, Math.min(cameraDistance * 0.04, 600));
  const axis = actualLength > Number.EPSILON ? delta.div(actualLength) : Point3D.XDirection;
  const length = actualLength > Number.EPSILON ? actualLength : fallbackLength;
  const end = actualLength > Number.EPSILON ? to : from.add(axis.scale(length));
  const reference =
    Math.abs(Point3D.dotProduct(axis, Point3D.ZDirection)) < 0.9 ? Point3D.ZDirection : Point3D.YDirection;
  const normal = Point3D.crossProduct(axis, reference).getNormalized();
  const amplitude = Math.max(5, Math.min(length * 0.12, fallbackLength * 0.25));
  const startCoil = from.add(axis.scale(length * 0.2));
  const endCoil = from.add(axis.scale(length * 0.8));
  const points = [from.clone(), startCoil];
  const turns = 6;
  for (let index = 1; index < turns; index++) {
    const fraction = index / turns;
    const center = startCoil.add(axis.scale(length * 0.6 * fraction));
    const offset = normal.scale((index % 2 === 0 ? -1 : 1) * amplitude);
    points.push(center.add(offset));
  }
  points.push(endCoil, end.clone());
  return points;
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
