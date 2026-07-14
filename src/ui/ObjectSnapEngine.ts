import type { Member } from '../data/Member';
import type { Node } from '../data/Node';
import { Point3D } from '../math/Point3D';

/** ステータス表示や将来のglyph描画で利用するスナップ種別。 */
export type ObjectSnapKind = 'none' | 'node' | 'endpoint' | 'midpoint' | 'intersection' | 'grid';

export interface SnapScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type ObjectSnapSource = Node | Member | readonly [Member, Member] | null;

export interface ObjectSnapResult {
  readonly position: Point3D;
  readonly kind: ObjectSnapKind;
  /** 入力位置から候補までの距離。常にCSS pixel単位。 */
  readonly distancePx: number;
  readonly source: ObjectSnapSource;
}

export interface ObjectSnapRequest {
  /** 画面位置を現在作業平面へ変換した座標。 */
  readonly position: Point3D;
  /** clientX/clientYと同じCSS pixel座標。 */
  readonly screenPoint: SnapScreenPoint;
  readonly workPlaneZ: number;
  readonly gridSpacing: number;
  readonly nodes: ReadonlyArray<Node>;
  readonly members: ReadonlyArray<Member>;
  /** ワールド座標をclientX/clientYと同じCSS pixel座標へ投影する。 */
  readonly project: (point: Point3D) => SnapScreenPoint | null;
  readonly tolerancePx?: number;
}

interface SnapCandidate {
  readonly position: Point3D;
  readonly kind: Exclude<ObjectSnapKind, 'none' | 'grid'>;
  readonly source: Exclude<ObjectSnapSource, null>;
  readonly order: number;
}

interface PlanSegment {
  readonly member: Member;
  readonly from: Point3D;
  readonly to: Point3D;
}

const DEFAULT_TOLERANCE_PX = 10;
const WORK_PLANE_EPSILON = 1e-6;
const INTERSECTION_EPSILON = 1e-12;

const SNAP_PRIORITY: Readonly<Record<SnapCandidate['kind'], number>> = {
  endpoint: 0,
  node: 0,
  midpoint: 1,
  intersection: 2,
};

/**
 * 構造CAD向けの作業平面スナップ。
 *
 * 候補の世界座標を画面へ投影してCSS pixel距離で判定するため、ズームや
 * perspective表示に依存せず同じ操作感を保つ。交点はカーソル近傍の平面内
 * 部材だけを組み合わせ、通常のmouse moveを全組合せ探索にしない。
 */
export class ObjectSnapEngine {
  resolve(request: ObjectSnapRequest): ObjectSnapResult {
    const tolerancePx = normalizeTolerance(request.tolerancePx);
    const candidates: SnapCandidate[] = [];
    let order = 0;

    const endpointNodes = new Set<Node>();
    for (const member of request.members) {
      if (!member.ok || !member.nodeI || !member.nodeJ) continue;
      endpointNodes.add(member.nodeI);
      endpointNodes.add(member.nodeJ);
    }

    // 不正な外部データでもMember端点を見落とさないよう、nodeListとの和集合にする。
    const allNodes = [...request.nodes];
    const knownNodes = new Set(request.nodes);
    for (const node of endpointNodes) {
      if (knownNodes.has(node)) continue;
      knownNodes.add(node);
      allNodes.push(node);
    }
    for (const node of allNodes) {
      if (!isFinitePoint(node.pos) || !isOnWorkPlane(node.pos.z, request.workPlaneZ)) continue;
      candidates.push({
        position: new Point3D(node.pos.x, node.pos.y, request.workPlaneZ),
        kind: endpointNodes.has(node) ? 'endpoint' : 'node',
        source: node,
        order: order++,
      });
    }

    const nearbyPlanSegments: PlanSegment[] = [];
    for (const member of request.members) {
      if (!member.ok || !member.nodeI || !member.nodeJ) continue;
      const from = member.nodeI.pos;
      const to = member.nodeJ.pos;
      if (!isFinitePoint(from) || !isFinitePoint(to)) continue;

      const midpoint = new Point3D((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      if (isOnWorkPlane(midpoint.z, request.workPlaneZ)) {
        midpoint.z = request.workPlaneZ;
        candidates.push({ position: midpoint, kind: 'midpoint', source: member, order: order++ });
      }

      // 2D交点は、両端が現在作業平面上にある部材の中心線だけを対象にする。
      if (!isOnWorkPlane(from.z, request.workPlaneZ) || !isOnWorkPlane(to.z, request.workPlaneZ)) continue;
      const planFrom = new Point3D(from.x, from.y, request.workPlaneZ);
      const planTo = new Point3D(to.x, to.y, request.workPlaneZ);
      if (squaredPlanLength(planFrom, planTo) <= INTERSECTION_EPSILON) continue;
      const screenFrom = request.project(planFrom);
      const screenTo = request.project(planTo);
      if (!screenFrom || !screenTo) continue;
      if (pointToSegmentDistance(request.screenPoint, screenFrom, screenTo) > tolerancePx) continue;
      nearbyPlanSegments.push({ member, from: planFrom, to: planTo });
    }

    for (let i = 0; i < nearbyPlanSegments.length; i++) {
      for (let j = i + 1; j < nearbyPlanSegments.length; j++) {
        const first = nearbyPlanSegments[i];
        const second = nearbyPlanSegments[j];
        const position = intersectPlanSegments(first.from, first.to, second.from, second.to, request.workPlaneZ);
        if (!position) continue;
        candidates.push({
          position,
          kind: 'intersection',
          source: [first.member, second.member] as const,
          order: order++,
        });
      }
    }

    const objectSnap = selectCandidate(candidates, request.screenPoint, request.project, tolerancePx);
    if (objectSnap) return objectSnap;

    return gridFallback(request);
  }
}

function selectCandidate(
  candidates: ReadonlyArray<SnapCandidate>,
  screenPoint: SnapScreenPoint,
  project: ObjectSnapRequest['project'],
  tolerancePx: number,
): ObjectSnapResult | null {
  let best: { candidate: SnapCandidate; distancePx: number } | null = null;
  for (const candidate of candidates) {
    const screen = project(candidate.position);
    if (!screen) continue;
    const distancePx = pointDistance(screenPoint, screen);
    if (!Number.isFinite(distancePx) || distancePx > tolerancePx) continue;

    if (!best || compareCandidate(candidate, distancePx, best.candidate, best.distancePx) < 0) {
      best = { candidate, distancePx };
    }
  }
  if (!best) return null;
  return {
    position: best.candidate.position.clone(),
    kind: best.candidate.kind,
    distancePx: best.distancePx,
    source: best.candidate.source,
  };
}

function compareCandidate(a: SnapCandidate, aDistance: number, b: SnapCandidate, bDistance: number): number {
  const priority = SNAP_PRIORITY[a.kind] - SNAP_PRIORITY[b.kind];
  if (priority !== 0) return priority;
  const distance = aDistance - bDistance;
  if (Math.abs(distance) > Number.EPSILON) return distance;
  return a.order - b.order;
}

function gridFallback(request: ObjectSnapRequest): ObjectSnapResult {
  const position = request.position.clone();
  position.z = request.workPlaneZ;
  if (!Number.isFinite(request.gridSpacing) || request.gridSpacing <= 0) {
    return { position, kind: 'none', distancePx: 0, source: null };
  }

  position.x = Math.round(position.x / request.gridSpacing) * request.gridSpacing;
  position.y = Math.round(position.y / request.gridSpacing) * request.gridSpacing;
  const screen = request.project(position);
  return {
    position,
    kind: 'grid',
    distancePx: screen ? pointDistance(request.screenPoint, screen) : Number.POSITIVE_INFINITY,
    source: null,
  };
}

function intersectPlanSegments(a: Point3D, b: Point3D, c: Point3D, d: Point3D, workPlaneZ: number): Point3D | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = cross2D(rx, ry, sx, sy);
  const lengthProduct = Math.sqrt((rx * rx + ry * ry) * (sx * sx + sy * sy));
  if (lengthProduct <= INTERSECTION_EPSILON) return null;
  if (Math.abs(denominator) <= INTERSECTION_EPSILON * lengthProduct) return null;

  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = cross2D(qx, qy, sx, sy) / denominator;
  const u = cross2D(qx, qy, rx, ry) / denominator;
  if (t < -WORK_PLANE_EPSILON || t > 1 + WORK_PLANE_EPSILON) return null;
  if (u < -WORK_PLANE_EPSILON || u > 1 + WORK_PLANE_EPSILON) return null;

  const clampedT = Math.max(0, Math.min(1, t));
  return new Point3D(a.x + clampedT * rx, a.y + clampedT * ry, workPlaneZ);
}

function pointToSegmentDistance(point: SnapScreenPoint, from: SnapScreenPoint, to: SnapScreenPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return pointDistance(point, from);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function pointDistance(a: SnapScreenPoint, b: SnapScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cross2D(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function squaredPlanLength(a: Point3D, b: Point3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

function isOnWorkPlane(value: number, workPlaneZ: number): boolean {
  return Number.isFinite(value) && Number.isFinite(workPlaneZ) && Math.abs(value - workPlaneZ) <= WORK_PLANE_EPSILON;
}

function isFinitePoint(point: Point3D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function normalizeTolerance(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined ? Math.max(0, value) : DEFAULT_TOLERANCE_PX;
}
