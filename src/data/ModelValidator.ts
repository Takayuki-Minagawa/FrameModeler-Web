import { BearWall } from './BearWall';
import type { DocumentData } from './DocumentData';
import { Floor, FloorDirection } from './Floor';
import { Member } from './Member';
import { Node } from './Node';
import { Plane } from './Plane';
import { Wall } from './Wall';
import { Point3D } from '../math/Point3D';
import type { Layer } from './Layer';
import { categoryOf, TYPE_REGISTRY, type NumberCategory } from './typeRegistry';

export interface ModelValidationOptions {
  /** Document が採番する前の候補モデルでは false を指定する。 */
  validateNumbers?: boolean;
}

export class ModelValidationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ModelValidationError';
  }
}

/**
 * Document、JSON、YAML、保存処理で共有するモデル不変条件。
 *
 * 同じ座標を持つ別 Node は解析データ由来では意味を持つため許可し、
 * Member/Plane の中で退化形状になる場合だけ拒否する。
 */
export class ModelValidator {
  static readonly MIN_MEMBER_LENGTH = 1e-9;
  static readonly MIN_PLANE_AREA = 1e-9;
  static readonly PLANAR_RELATIVE_TOLERANCE = 1e-9;
  static readonly PLANAR_ABSOLUTE_TOLERANCE = 1e-6;

  static validateModel(
    dataList: ReadonlyArray<DocumentData>,
    layers: ReadonlyArray<Layer> = [],
    options: ModelValidationOptions = {},
  ): void {
    const validateNumbers = options.validateNumbers ?? true;
    const dataSet = new Set<DocumentData>();
    for (let i = 0; i < dataList.length; i++) {
      const data = dataList[i];
      if (dataSet.has(data)) {
        throw new ModelValidationError('the same object occurs more than once', `data[${i}]`);
      }
      dataSet.add(data);
      if (!TYPE_REGISTRY.some((entry) => data.constructor === entry.ctor)) {
        throw new ModelValidationError(`unsupported data type '${data.constructor.name}'`, `data[${i}]`);
      }
    }

    const nodes = dataList.filter((data): data is Node => data.constructor === Node);
    const nodeSet = new Set(nodes);
    nodes.forEach((node, index) => this.validateNode(node, `nodes[${index}]`));

    dataList.forEach((data, index) => {
      const path = `data[${index}]`;
      this.requireBoolean(data.select, `${path}.select`);
      if (data instanceof Member) this.validateMember(data, nodeSet, path);
      if (data instanceof Plane) this.validatePlane(data, nodeSet, path);
    });

    if (validateNumbers) this.validateAssignedNumbers(dataList);
    this.validateLayers(layers);
  }

  static validateLayers(layers: ReadonlyArray<Layer>): void {
    const elevations = new Set<number>();
    layers.forEach((layer, index) => {
      const path = `layers[${index}]`;
      this.requireFinite(layer.posZ, `${path}.posZ`);
      if (typeof layer.name !== 'string') {
        throw new ModelValidationError('expected string', `${path}.name`);
      }
      if (elevations.has(layer.posZ)) {
        throw new ModelValidationError(`duplicate layer elevation ${layer.posZ}`, `${path}.posZ`);
      }
      elevations.add(layer.posZ);
    });
  }

  static requireId(value: unknown, path: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new ModelValidationError('expected a finite, non-negative integer', path);
    }
  }

  static requireFinite(value: unknown, path: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ModelValidationError('expected finite number', path);
    }
  }

  private static validateNode(node: Node, path: string): void {
    this.requireFinite(node.pos.x, `${path}.pos.x`);
    this.requireFinite(node.pos.y, `${path}.pos.y`);
    this.requireFinite(node.pos.z, `${path}.pos.z`);
  }

  private static validateMember(member: Member, nodes: Set<Node>, path: string): void {
    if (!(member.nodeI instanceof Node) || !(member.nodeJ instanceof Node)) {
      throw new ModelValidationError('both endpoint nodes are required', path);
    }
    if (!nodes.has(member.nodeI)) {
      throw new ModelValidationError('nodeI does not belong to this Document', `${path}.nodeI`);
    }
    if (!nodes.has(member.nodeJ)) {
      throw new ModelValidationError('nodeJ does not belong to this Document', `${path}.nodeJ`);
    }
    if (member.nodeI === member.nodeJ) {
      throw new ModelValidationError('member endpoints must be different nodes', path);
    }
    const length = member.nodeI.pos.sub(member.nodeJ.pos).length;
    this.requireFinite(length, `${path}.length`);
    if (length <= this.MIN_MEMBER_LENGTH) {
      throw new ModelValidationError(`member length must be greater than ${this.MIN_MEMBER_LENGTH}`, path);
    }
    if (typeof member.section !== 'string') {
      throw new ModelValidationError('expected string', `${path}.section`);
    }
    this.requireBoolean(member.isNodeReverse, `${path}.isNodeReverse`);
  }

  private static validatePlane(plane: Plane, nodes: Set<Node>, path: string): void {
    const expected =
      plane.constructor === Floor
        ? { min: 3, text: 'at least 3' }
        : plane.constructor === Wall || plane.constructor === BearWall
          ? { min: 4, max: 4, text: 'exactly 4' }
          : null;
    if (!expected) {
      throw new ModelValidationError(`unsupported plane type '${plane.constructor.name}'`, path);
    }
    if (plane.nodeCount < expected.min || (expected.max !== undefined && plane.nodeCount > expected.max)) {
      throw new ModelValidationError(`plane requires ${expected.text} nodes, got ${plane.nodeCount}`, `${path}.nodes`);
    }

    const seenNodes = new Set<Node>();
    const seenCoords = new Set<string>();
    plane.nodeList.forEach((node, index) => {
      const nodePath = `${path}.nodes[${index}]`;
      if (!(node instanceof Node) || !nodes.has(node)) {
        throw new ModelValidationError('referenced node does not belong to this Document', nodePath);
      }
      if (seenNodes.has(node)) {
        throw new ModelValidationError('duplicate node reference', nodePath);
      }
      seenNodes.add(node);
      const key = `${node.pos.x}:${node.pos.y}:${node.pos.z}`;
      if (seenCoords.has(key)) {
        throw new ModelValidationError('duplicate vertex coordinate', nodePath);
      }
      seenCoords.add(key);
    });

    const points = plane.nodeList.map((node) => node.pos);
    this.validatePolygon(points, path);
    if (typeof plane.section !== 'string') {
      throw new ModelValidationError('expected string', `${path}.section`);
    }
    if (plane instanceof Floor) {
      this.requireFinite(plane.weight, `${path}.weight`);
      if (!(Object.values(FloorDirection) as unknown[]).includes(plane.direction)) {
        throw new ModelValidationError(`invalid floor direction '${String(plane.direction)}'`, `${path}.direction`);
      }
    } else if (plane instanceof Wall) {
      this.requireFinite(plane.weight, `${path}.weight`);
    }
  }

  private static validatePolygon(points: ReadonlyArray<Point3D>, path: string): void {
    const { normal, origin, scale } = this.findPlane(points, path);
    const normalLength = normal.length;
    const unitNormal = normal.div(normalLength);
    const planarTolerance = Math.max(this.PLANAR_ABSOLUTE_TOLERANCE, scale * this.PLANAR_RELATIVE_TOLERANCE);
    points.forEach((point, index) => {
      const distance = Math.abs(Point3D.dotProduct(point.sub(origin), unitNormal));
      if (distance > planarTolerance) {
        throw new ModelValidationError(
          `non-planar vertex (distance ${distance} exceeds tolerance ${planarTolerance})`,
          `${path}.nodes[${index}]`,
        );
      }
    });

    const projected = this.projectTo2D(points, unitNormal);
    if (this.hasSelfIntersection(projected, scale)) {
      throw new ModelValidationError('polygon edges self-intersect or overlap', `${path}.nodes`);
    }

    const areaVector = points.reduce(
      (sum, point, index) => sum.add(Point3D.crossProduct(point, points[(index + 1) % points.length])),
      new Point3D(),
    );
    const area = areaVector.length / 2;
    this.requireFinite(area, `${path}.area`);
    if (area <= this.MIN_PLANE_AREA) {
      throw new ModelValidationError(`plane area must be greater than ${this.MIN_PLANE_AREA}`, path);
    }
  }

  private static findPlane(
    points: ReadonlyArray<Point3D>,
    path: string,
  ): {
    origin: Point3D;
    normal: Point3D;
    scale: number;
  } {
    const origin = points[0];
    let scale = 0;
    for (const point of points) scale = Math.max(scale, point.sub(origin).length);
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i].sub(origin);
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j].sub(origin);
        const normal = Point3D.crossProduct(a, b);
        if (normal.length > this.MIN_PLANE_AREA) return { origin, normal, scale };
      }
    }
    throw new ModelValidationError('plane vertices are collinear', `${path}.nodes`);
  }

  private static projectTo2D(points: ReadonlyArray<Point3D>, normal: Point3D): Point2[] {
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);
    if (ax >= ay && ax >= az) return points.map((point) => ({ x: point.y, y: point.z }));
    if (ay >= az) return points.map((point) => ({ x: point.x, y: point.z }));
    return points.map((point) => ({ x: point.x, y: point.y }));
  }

  private static hasSelfIntersection(points: ReadonlyArray<Point2>, scale: number): boolean {
    const tolerance = Math.max(this.MIN_MEMBER_LENGTH, scale * this.PLANAR_RELATIVE_TOLERANCE);
    for (let i = 0; i < points.length; i++) {
      const iNext = (i + 1) % points.length;
      for (let j = i + 1; j < points.length; j++) {
        const jNext = (j + 1) % points.length;
        if (i === j || iNext === j || jNext === i) continue;
        if (segmentsIntersect(points[i], points[iNext], points[j], points[jNext], tolerance)) {
          return true;
        }
      }
    }
    return false;
  }

  private static validateAssignedNumbers(dataList: ReadonlyArray<DocumentData>): void {
    const used: Record<NumberCategory, Set<number>> = {
      node: new Set(),
      member: new Set(),
      plane: new Set(),
    };
    dataList.forEach((data, index) => {
      const category = categoryOf(data);
      if (!category) throw new ModelValidationError('unsupported number category', `data[${index}]`);
      this.requireId(data.number, `data[${index}].number`);
      if (used[category].has(data.number)) {
        throw new ModelValidationError(`duplicate ${category} number ${data.number}`, `data[${index}].number`);
      }
      used[category].add(data.number);
    });
  }

  private static requireBoolean(value: unknown, path: string): asserts value is boolean {
    if (typeof value !== 'boolean') throw new ModelValidationError('expected boolean', path);
  }
}

interface Point2 {
  x: number;
  y: number;
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point2, b: Point2, p: Point2, tolerance: number): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - tolerance &&
    p.x <= Math.max(a.x, b.x) + tolerance &&
    p.y >= Math.min(a.y, b.y) - tolerance &&
    p.y <= Math.max(a.y, b.y) + tolerance
  );
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2, tolerance: number): boolean {
  const crossTolerance = tolerance * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - c.x, d.y - c.y));
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (
    ((o1 > crossTolerance && o2 < -crossTolerance) || (o1 < -crossTolerance && o2 > crossTolerance)) &&
    ((o3 > crossTolerance && o4 < -crossTolerance) || (o3 < -crossTolerance && o4 > crossTolerance))
  ) {
    return true;
  }
  if (Math.abs(o1) <= crossTolerance && onSegment(a, b, c, tolerance)) return true;
  if (Math.abs(o2) <= crossTolerance && onSegment(a, b, d, tolerance)) return true;
  if (Math.abs(o3) <= crossTolerance && onSegment(c, d, a, tolerance)) return true;
  if (Math.abs(o4) <= crossTolerance && onSegment(c, d, b, tolerance)) return true;
  return false;
}
