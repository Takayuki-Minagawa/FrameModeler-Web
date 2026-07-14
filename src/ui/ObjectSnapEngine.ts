import type { Member } from '../data/Member';
import type { Node } from '../data/Node';
import { Point3D } from '../math/Point3D';

/** ステータス表示や将来のglyph描画で利用するスナップ種別。 */
export type ObjectSnapKind = 'none' | 'node' | 'endpoint' | 'midpoint' | 'intersection' | 'grid';

/** anchorから推論する高度作図拘束。既存ObjectSnapKindとは分離して後方互換を保つ。 */
export type ObjectSnapConstraintKind = 'horizontal' | 'vertical' | 'axis-x' | 'axis-y' | 'orthogonal';

/** 候補一覧・glyphでは通常スナップと作図拘束を同じ種別として扱う。 */
export type ObjectSnapCandidateKind = ObjectSnapKind | ObjectSnapConstraintKind;

export type ObjectSnapGlyph =
  | 'none'
  | 'node-circle'
  | 'endpoint-square'
  | 'midpoint-triangle'
  | 'intersection-cross'
  | 'grid-cross'
  | 'horizontal-line'
  | 'vertical-line'
  | 'x-axis'
  | 'y-axis'
  | 'right-angle';

export interface ObjectSnapKindInfo {
  readonly kind: ObjectSnapCandidateKind;
  /** i18n層で翻訳するための安定キー。 */
  readonly labelKey: string;
  /** i18n未接続の利用者向け英語fallback。 */
  readonly label: string;
  readonly glyph: ObjectSnapGlyph;
}

export const OBJECT_SNAP_KIND_INFO: Readonly<Record<ObjectSnapCandidateKind, ObjectSnapKindInfo>> = {
  none: { kind: 'none', labelKey: 'snap.none', label: 'None', glyph: 'none' },
  node: { kind: 'node', labelKey: 'snap.node', label: 'Node', glyph: 'node-circle' },
  endpoint: { kind: 'endpoint', labelKey: 'snap.endpoint', label: 'Endpoint', glyph: 'endpoint-square' },
  midpoint: { kind: 'midpoint', labelKey: 'snap.midpoint', label: 'Midpoint', glyph: 'midpoint-triangle' },
  intersection: {
    kind: 'intersection',
    labelKey: 'snap.intersection',
    label: 'Intersection',
    glyph: 'intersection-cross',
  },
  grid: { kind: 'grid', labelKey: 'snap.grid', label: 'Grid', glyph: 'grid-cross' },
  horizontal: {
    kind: 'horizontal',
    labelKey: 'snap.horizontal',
    label: 'Horizontal',
    glyph: 'horizontal-line',
  },
  vertical: {
    kind: 'vertical',
    labelKey: 'snap.vertical',
    label: 'Vertical',
    glyph: 'vertical-line',
  },
  'axis-x': { kind: 'axis-x', labelKey: 'snap.axisX', label: 'X axis', glyph: 'x-axis' },
  'axis-y': { kind: 'axis-y', labelKey: 'snap.axisY', label: 'Y axis', glyph: 'y-axis' },
  orthogonal: {
    kind: 'orthogonal',
    labelKey: 'snap.orthogonal',
    label: 'Orthogonal',
    glyph: 'right-angle',
  },
};

export interface SnapScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type ObjectSnapSource = Node | Member | readonly [Member, Member] | null;

export interface ObjectSnapResult {
  readonly position: Point3D;
  /** 既存利用者向けの粗い種別。作図拘束候補ではnoneとなる。 */
  readonly kind: ObjectSnapKind;
  /** glyph・label・候補循環で使う精密な種別。旧形式resultでは省略可能。 */
  readonly candidateKind?: ObjectSnapCandidateKind;
  /** 再計算した候補一覧でも同じ候補を追跡するための決定的ID。 */
  readonly candidateId?: string;
  /** 同じ座標へ収束して重複表示を抑制した、代替拘束種別。 */
  readonly equivalentKinds?: ReadonlyArray<ObjectSnapConstraintKind>;
  /** 入力位置から候補までの距離。常にCSS pixel単位。 */
  readonly distancePx: number;
  readonly source: ObjectSnapSource;
}

export interface AnchorConstraintRequest {
  readonly anchor: Point3D;
  /** 省略時は利用可能な全拘束を生成する。順序は入力順ではなく固定。 */
  readonly kinds?: ReadonlyArray<ObjectSnapConstraintKind>;
  /**
   * 画面水平・鉛直拘束を作業平面座標へ戻す。未指定時もX/Y軸・直交は利用できる。
   * 戻り値のZはworkPlaneZへ正規化される。
   */
  readonly screenToWorkPlane?: (screen: SnapScreenPoint) => Point3D | null;
  /** このXY方向に直交する、anchorを通る線へ入力点を投影する。 */
  readonly orthogonalTo?: Point3D;
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
  readonly constraints?: AnchorConstraintRequest;
}

interface SnapCandidate {
  readonly position: Point3D;
  readonly kind: Exclude<ObjectSnapCandidateKind, 'none' | 'grid'>;
  readonly source: ObjectSnapSource;
  readonly id: string;
  readonly order: number;
  equivalentKinds?: ObjectSnapConstraintKind[];
}

interface PlanSegment {
  readonly member: Member;
  readonly from: Point3D;
  readonly to: Point3D;
}

const DEFAULT_TOLERANCE_PX = 10;
const WORK_PLANE_EPSILON = 1e-6;
const INTERSECTION_EPSILON = 1e-12;

const CONSTRAINT_ORDER: ReadonlyArray<ObjectSnapConstraintKind> = [
  'orthogonal',
  'axis-x',
  'axis-y',
  'horizontal',
  'vertical',
];

const SNAP_PRIORITY: Readonly<Record<SnapCandidate['kind'], number>> = {
  endpoint: 0,
  node: 0,
  midpoint: 1,
  intersection: 2,
  orthogonal: 3,
  'axis-x': 4,
  'axis-y': 4,
  horizontal: 5,
  vertical: 5,
};

/**
 * 構造CAD向けの作業平面スナップ。
 *
 * 候補の世界座標を画面へ投影してCSS pixel距離で判定するため、ズームや
 * perspective表示に依存せず同じ操作感を保つ。交点はカーソル近傍の平面内
 * 部材だけを組み合わせ、通常のmouse moveを全組合せ探索にしない。
 */
export class ObjectSnapEngine {
  private readonly sourceIds = new WeakMap<object, number>();
  private nextSourceId = 1;

  resolve(request: ObjectSnapRequest): ObjectSnapResult {
    return this.resolveCandidates(request)[0];
  }

  /**
   * 許容幅内の全候補を優先度・CSS px距離・モデル順で安定ソートして返す。
   * 候補がない場合だけgrid/none fallbackを1件返すため、配列は常に非空となる。
   */
  resolveCandidates(request: ObjectSnapRequest): ReadonlyArray<ObjectSnapResult> {
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
    for (let nodeIndex = 0; nodeIndex < allNodes.length; nodeIndex++) {
      const node = allNodes[nodeIndex];
      if (!isFinitePoint(node.pos) || !isOnWorkPlane(node.pos.z, request.workPlaneZ)) continue;
      const kind = endpointNodes.has(node) ? 'endpoint' : 'node';
      candidates.push({
        position: new Point3D(node.pos.x, node.pos.y, request.workPlaneZ),
        kind,
        source: node,
        id: `${kind}:node-${this.sourceId(node)}`,
        order: order++,
      });
    }

    const nearbyPlanSegments: PlanSegment[] = [];
    for (let memberIndex = 0; memberIndex < request.members.length; memberIndex++) {
      const member = request.members[memberIndex];
      if (!member.ok || !member.nodeI || !member.nodeJ) continue;
      const from = member.nodeI.pos;
      const to = member.nodeJ.pos;
      if (!isFinitePoint(from) || !isFinitePoint(to)) continue;

      const midpoint = new Point3D((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      if (isOnWorkPlane(midpoint.z, request.workPlaneZ)) {
        midpoint.z = request.workPlaneZ;
        candidates.push({
          position: midpoint,
          kind: 'midpoint',
          source: member,
          id: `midpoint:member-${this.sourceId(member)}`,
          order: order++,
        });
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
        const sourceIds = [this.sourceId(first.member), this.sourceId(second.member)].sort((a, b) => a - b);
        candidates.push({
          position,
          kind: 'intersection',
          source: [first.member, second.member] as const,
          id: `intersection:member-${sourceIds[0]}-${sourceIds[1]}`,
          order: order++,
        });
      }
    }

    addConstraintCandidates(candidates, request, order);

    const objectSnaps = selectCandidates(candidates, request.screenPoint, request.project, tolerancePx);
    if (objectSnaps.length > 0) return Object.freeze(objectSnaps);

    return Object.freeze([gridFallback(request)]);
  }

  private sourceId(source: object): number {
    const existing = this.sourceIds.get(source);
    if (existing !== undefined) return existing;
    const id = this.nextSourceId++;
    this.sourceIds.set(source, id);
    return id;
  }
}

export interface ObjectSnapCycleSelection {
  readonly index: number;
  readonly candidate: ObjectSnapResult;
}

/** 旧resultを含め、glyph/labelに使う実効種別を返す。 */
export function getObjectSnapCandidateKind(result: ObjectSnapResult): ObjectSnapCandidateKind {
  return result.candidateKind ?? result.kind;
}

export function getObjectSnapKindInfo(kind: ObjectSnapCandidateKind): ObjectSnapKindInfo {
  return OBJECT_SNAP_KIND_INFO[kind];
}

/**
 * candidateIdを基準に次/前候補へ循環する。候補再計算後も同じIDから継続でき、
 * IDが消えた場合は正方向なら先頭、逆方向なら末尾へ安全に復帰する。
 */
export function cycleObjectSnapCandidate(
  candidates: ReadonlyArray<ObjectSnapResult>,
  currentCandidateId: string | null | undefined,
  direction: number = 1,
): ObjectSnapCycleSelection | null {
  if (candidates.length === 0) return null;
  const currentIndex = currentCandidateId
    ? candidates.findIndex((candidate) => candidate.candidateId === currentCandidateId)
    : -1;
  const step = !Number.isFinite(direction) || direction > 0 ? 1 : direction < 0 ? -1 : 0;
  const index =
    currentIndex < 0 ? (step < 0 ? candidates.length - 1 : 0) : modulo(currentIndex + step, candidates.length);
  return { index, candidate: cloneResult(candidates[index]) };
}

function addConstraintCandidates(candidates: SnapCandidate[], request: ObjectSnapRequest, startOrder: number): void {
  const constraints = request.constraints;
  if (!constraints || !isFinitePoint(constraints.anchor) || !isFinitePoint(request.position)) return;
  if (!Number.isFinite(request.workPlaneZ)) return;

  const enabled = new Set(constraints.kinds ?? CONSTRAINT_ORDER);
  const anchor = new Point3D(constraints.anchor.x, constraints.anchor.y, request.workPlaneZ);
  let order = startOrder;
  const add = (kind: ObjectSnapConstraintKind, position: Point3D | null): void => {
    if (!enabled.has(kind) || !position || !isFinitePoint(position)) return;
    const normalized = position.clone();
    normalized.z = request.workPlaneZ;
    const equivalent = candidates.find(
      (candidate) =>
        isConstraintCandidateKind(candidate.kind) &&
        sameConstraintPosition(candidate.position, normalized, request.project),
    );
    if (equivalent) {
      equivalent.equivalentKinds ??= [];
      if (!equivalent.equivalentKinds.includes(kind)) equivalent.equivalentKinds.push(kind);
      return;
    }
    candidates.push({
      position: normalized,
      kind,
      source: null,
      id: `constraint:${kind}`,
      order: order++,
    });
  };

  for (const kind of CONSTRAINT_ORDER) {
    switch (kind) {
      case 'axis-x':
        add(kind, new Point3D(request.position.x, anchor.y, request.workPlaneZ));
        break;
      case 'axis-y':
        add(kind, new Point3D(anchor.x, request.position.y, request.workPlaneZ));
        break;
      case 'horizontal': {
        const anchorScreen = request.project(anchor);
        const position =
          anchorScreen && constraints.screenToWorkPlane
            ? constraints.screenToWorkPlane({ x: request.screenPoint.x, y: anchorScreen.y })
            : null;
        add(kind, position);
        break;
      }
      case 'vertical': {
        const anchorScreen = request.project(anchor);
        const position =
          anchorScreen && constraints.screenToWorkPlane
            ? constraints.screenToWorkPlane({ x: anchorScreen.x, y: request.screenPoint.y })
            : null;
        add(kind, position);
        break;
      }
      case 'orthogonal':
        add(kind, orthogonalProjection(anchor, request.position, constraints.orthogonalTo));
        break;
    }
  }
}

function orthogonalProjection(anchor: Point3D, position: Point3D, reference: Point3D | undefined): Point3D | null {
  if (!reference || !isFinitePoint(reference)) return null;
  const length = Math.hypot(reference.x, reference.y);
  if (length <= INTERSECTION_EPSILON) return null;
  const perpendicularX = -reference.y / length;
  const perpendicularY = reference.x / length;
  const offsetX = position.x - anchor.x;
  const offsetY = position.y - anchor.y;
  const distance = offsetX * perpendicularX + offsetY * perpendicularY;
  return new Point3D(anchor.x + perpendicularX * distance, anchor.y + perpendicularY * distance, anchor.z);
}

function selectCandidates(
  candidates: ReadonlyArray<SnapCandidate>,
  screenPoint: SnapScreenPoint,
  project: ObjectSnapRequest['project'],
  tolerancePx: number,
): ObjectSnapResult[] {
  const eligible: Array<{ candidate: SnapCandidate; distancePx: number }> = [];
  for (const candidate of candidates) {
    const screen = project(candidate.position);
    if (!screen) continue;
    const distancePx = pointDistance(screenPoint, screen);
    if (!Number.isFinite(distancePx) || distancePx > tolerancePx) continue;
    eligible.push({ candidate, distancePx });
  }
  eligible.sort((a, b) => compareCandidate(a.candidate, a.distancePx, b.candidate, b.distancePx));
  return eligible.map(({ candidate, distancePx }) => ({
    position: candidate.position.clone(),
    kind: isLegacySnapKind(candidate.kind) ? candidate.kind : 'none',
    candidateKind: candidate.kind,
    candidateId: candidate.id,
    equivalentKinds: candidate.equivalentKinds?.length ? Object.freeze([...candidate.equivalentKinds]) : undefined,
    distancePx,
    source: candidate.source,
  }));
}

function cloneResult(result: ObjectSnapResult): ObjectSnapResult {
  const source = Array.isArray(result.source) ? ([result.source[0], result.source[1]] as const) : result.source;
  return { ...result, position: result.position.clone(), source };
}

function isLegacySnapKind(kind: ObjectSnapCandidateKind): kind is ObjectSnapKind {
  return kind === 'node' || kind === 'endpoint' || kind === 'midpoint' || kind === 'intersection';
}

function isConstraintCandidateKind(kind: SnapCandidate['kind']): kind is ObjectSnapConstraintKind {
  return (
    kind === 'horizontal' || kind === 'vertical' || kind === 'axis-x' || kind === 'axis-y' || kind === 'orthogonal'
  );
}

function sameConstraintPosition(first: Point3D, second: Point3D, project: ObjectSnapRequest['project']): boolean {
  if (squaredPlanLength(first, second) <= WORK_PLANE_EPSILON * WORK_PLANE_EPSILON) return true;
  const firstScreen = project(first);
  const secondScreen = project(second);
  return !!firstScreen && !!secondScreen && pointDistance(firstScreen, secondScreen) <= 1e-6;
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
    return {
      position,
      kind: 'none',
      candidateKind: 'none',
      candidateId: 'fallback:none',
      distancePx: 0,
      source: null,
    };
  }

  position.x = Math.round(position.x / request.gridSpacing) * request.gridSpacing;
  position.y = Math.round(position.y / request.gridSpacing) * request.gridSpacing;
  const screen = request.project(position);
  return {
    position,
    kind: 'grid',
    candidateKind: 'grid',
    candidateId: 'fallback:grid',
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

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
