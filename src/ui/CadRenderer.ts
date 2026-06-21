import * as THREE from 'three';
import { Document } from '../data/Document';
import { Node } from '../data/Node';
import { Member } from '../data/Member';
import { Pillar } from '../data/Pillar';
import { Plane } from '../data/Plane';
import { Floor, FloorDirection } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Point3D } from '../math/Point3D';
import { CAD, type CadPalette } from './CadConfig';

/** rebuildScene が必要とする可変状態（呼び出し側で算出して渡す） */
export interface RenderContext {
  palette: CadPalette;
  show3D: boolean;
  cameraDistance: number;
  layerZ: number;
  showGrid: boolean;
  gridWidth: number;
}

/**
 * シーン描画専任クラス（V-1）。
 * gridGroup/elementGroup/previewGroup を所有し、コンストラクタで scene に add。
 * 描画ロジックは CadView から無変更で移設。
 */
export class CadRenderer {
  // Three.jsオブジェクトグループ
  private gridGroup = new THREE.Group();
  private elementGroup = new THREE.Group();
  private previewGroup = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.gridGroup);
    scene.add(this.elementGroup);
    scene.add(this.previewGroup);
  }

  /** データ変更を伴うシーン再構築。可変状態は ctx で受け取る。 */
  rebuild(ctx: RenderContext): void {
    this.clearGroup(this.gridGroup);
    this.clearGroup(this.elementGroup);

    if (ctx.showGrid) {
      this.drawGrid(ctx);
    }

    this.drawElements(ctx);
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }
  }

  clearPreview(): void {
    this.clearGroup(this.previewGroup);
  }

  addPreviewLine(from: Point3D, to: Point3D, color: number): void {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    this.previewGroup.add(new THREE.Line(geom, mat));
  }

  addPreviewPoint(pos: Point3D, color: number): void {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pos.x, pos.y, pos.z),
    ]);
    const mat = new THREE.PointsMaterial({ color, size: CAD.PREVIEW_POINT_SIZE, sizeAttenuation: false });
    this.previewGroup.add(new THREE.Points(geom, mat));
  }

  /** 頂点列を閉ループとしてプレビュー線で描く（4辺ループ等の共通化用） */
  addPreviewPolygon(points: Point3D[], color: number): void {
    for (let i = 0; i < points.length; i++) {
      const next = points[(i + 1) % points.length];
      this.addPreviewLine(points[i], next, color);
    }
  }

  // ========== グリッド描画 ==========

  private drawGrid(ctx: RenderContext): void {
    const layerZ = ctx.layerZ;
    const range = ctx.cameraDistance * CAD.GRID_RANGE_RATIO;
    // ズームアウト時の過剰な線生成を抑えるためグリッド幅をクランプ（V-10）
    const gw = Math.max(ctx.gridWidth, (range * 2) / CAD.MAX_GRID_LINES);

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
      const mat = new THREE.LineBasicMaterial({ color: ctx.palette.grid, transparent: true, opacity: 0.5 });
      this.gridGroup.add(new THREE.LineSegments(geom, mat));
    }

    this.addLineToGroup(this.gridGroup, new THREE.Vector3(-range, 0, layerZ), new THREE.Vector3(range, 0, layerZ), ctx.palette.axisX);
    this.addLineToGroup(this.gridGroup, new THREE.Vector3(0, -range, layerZ), new THREE.Vector3(0, range, layerZ), ctx.palette.axisY);
  }

  private addLineToGroup(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color });
    group.add(new THREE.Line(geom, mat));
  }

  // ========== 要素描画 ==========

  private drawElements(ctx: RenderContext): void {
    const doc = Document.instance;
    const showAll = ctx.show3D || !doc.shownLayer;

    const p = ctx.palette;

    for (const node of doc.nodeList) {
      if (!showAll && !node.existsOn(doc.shownLayer)) continue;
      const isOnLayer = node.existsOn(doc.shownLayer);
      const color = node.select ? p.select : p.node;
      const opacity = isOnLayer ? 1.0 : 0.3;
      this.drawNode(node, color, opacity);
    }

    for (const member of doc.memberList) {
      if (!member.ok) continue;
      if (!showAll && !member.existsOn(doc.shownLayer)) continue;
      const isOnLayer = member.existsOn(doc.shownLayer);
      const color = member.select ? p.select : p.member;
      const opacity = isOnLayer ? 1.0 : 0.3;

      if (member instanceof Pillar && !ctx.show3D) {
        this.drawPillarCircle(member, color, opacity, ctx.cameraDistance);
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
        const color = plane.select ? p.select : p.member;
        this.drawFloor(plane, color, isOnLayer ? 0.3 : 0.15);
      } else if (plane instanceof Wall) {
        const color = plane.select ? p.select : p.wall;
        this.drawPlanePolygon(plane, color, isOnLayer ? 0.15 : 0.08);
      } else if (plane instanceof BearWall) {
        const color = plane.select ? p.select : p.member;
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
      color, size: CAD.NODE_SIZE, sizeAttenuation: false,
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
      color, linewidth: CAD.MEMBER_LINEWIDTH,
      transparent: opacity < 1, opacity,
    });
    this.elementGroup.add(new THREE.Line(geom, mat));
  }

  private drawPillarCircle(pillar: Pillar, color: number, opacity: number, cameraDistance: number): void {
    const pos = pillar.nodeI!.pos;
    const radius = cameraDistance * CAD.PILLAR_RADIUS_RATIO;
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

// ========== Three.js ユーティリティ ==========

/** Mesh/Line/Points の geometry と material(配列含む) を破棄する（V-6） */
function disposeObject(obj: THREE.Object3D): void {
  const renderable = obj as Partial<THREE.Mesh>;
  renderable.geometry?.dispose();
  const mat = renderable.material;
  if (Array.isArray(mat)) {
    mat.forEach((m) => m.dispose());
  } else {
    mat?.dispose();
  }
}
