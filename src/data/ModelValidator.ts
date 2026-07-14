import type { DocumentData } from './DocumentData';
import { Floor, FloorDirection } from './Floor';
import { Member } from './Member';
import { Node } from './Node';
import { Plane } from './Plane';
import { Wall } from './Wall';
import { Point3D } from '../math/Point3D';
import type { Layer } from './Layer';
import { categoryOf, registeredTypeOf, type NumberCategory } from './typeRegistry';
import { Spring } from './Spring';
import { Truss } from './Truss';
import { Support } from './Support';
import { Constraint } from './Constraint';
import { isStructuralDof } from './StructuralDof';

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
      if (!registeredTypeOf(data)) {
        throw new ModelValidationError(`unsupported data kind '${data.kind}'`, `data[${i}]`);
      }
    }

    const nodes = dataList.filter((data): data is Node => data.kind === 'node');
    const nodeSet = new Set(nodes);
    nodes.forEach((node, index) => this.validateNode(node, `nodes[${index}]`));

    dataList.forEach((data, index) => {
      const path = `data[${index}]`;
      this.requireBoolean(data.select, `${path}.select`);
      if (data instanceof Member) this.validateMember(data, nodeSet, path);
      if (data instanceof Plane) this.validatePlane(data, nodeSet, path);
      if (data instanceof Support) this.validateSupport(data, nodeSet, path);
      if (data instanceof Constraint) this.validateConstraint(data, nodeSet, path);
    });

    if (validateNumbers) this.validateAssignedNumbers(dataList);
    this.validateLayers(layers);
  }

  /**
   * 点検UI向けに、独立した要素・レイヤーの不変条件違反を可能な限り収集する。
   * 保存境界で使う validateModel は従来どおり最初の違反で停止する。
   */
  static collectModelErrors(
    dataList: ReadonlyArray<DocumentData>,
    layers: ReadonlyArray<Layer> = [],
    options: ModelValidationOptions = {},
  ): ModelValidationError[] {
    const errors: ModelValidationError[] = [];
    const seenErrors = new Set<string>();
    const run = (fallbackPath: string, validation: () => void): void => {
      try {
        validation();
      } catch (error) {
        const normalized =
          error instanceof ModelValidationError
            ? error
            : new ModelValidationError((error as Error).message || String(error), fallbackPath);
        const key = `${normalized.path}\u0000${normalized.message}`;
        if (!seenErrors.has(key)) {
          seenErrors.add(key);
          errors.push(normalized);
        }
      }
    };

    const firstIndexByData = new Map<DocumentData, number>();
    const registered = new Set<DocumentData>();
    dataList.forEach((data, index) => {
      const firstIndex = firstIndexByData.get(data);
      if (firstIndex !== undefined) {
        run(`data[${index}]`, () => {
          throw new ModelValidationError(
            `the same object occurs more than once (first at data[${firstIndex}])`,
            `data[${index}]`,
          );
        });
        return;
      }
      firstIndexByData.set(data, index);
      if (!registeredTypeOf(data)) {
        run(`data[${index}]`, () => {
          throw new ModelValidationError(`unsupported data kind '${data.kind}'`, `data[${index}]`);
        });
        return;
      }
      registered.add(data);
    });

    const nodes = dataList.filter(
      (data, index): data is Node =>
        registered.has(data) && data instanceof Node && firstIndexByData.get(data) === index,
    );
    const nodeSet = new Set(nodes);
    nodes.forEach((node, index) => run(`nodes[${index}]`, () => this.validateNode(node, `nodes[${index}]`)));

    dataList.forEach((data, index) => {
      if (!registered.has(data) || firstIndexByData.get(data) !== index) return;
      const path = `data[${index}]`;
      run(`${path}.select`, () => this.requireBoolean(data.select, `${path}.select`));
      if (data instanceof Member) run(path, () => this.validateMember(data, nodeSet, path));
      if (data instanceof Plane) run(path, () => this.validatePlane(data, nodeSet, path));
      if (data instanceof Support) run(path, () => this.validateSupport(data, nodeSet, path));
      if (data instanceof Constraint) run(path, () => this.validateConstraint(data, nodeSet, path));
    });

    if (options.validateNumbers ?? true) {
      const used: Record<NumberCategory, Set<number>> = {
        node: new Set(),
        member: new Set(),
        plane: new Set(),
        constraint: new Set(),
      };
      dataList.forEach((data, index) => {
        if (!registered.has(data) || firstIndexByData.get(data) !== index) return;
        const path = `data[${index}].number`;
        const category = categoryOf(data);
        if (!category) return;
        const before = errors.length;
        run(path, () => this.requireId(data.number, path));
        if (errors.length !== before || used[category].has(data.number)) {
          if (used[category].has(data.number)) {
            run(path, () => {
              throw new ModelValidationError(`duplicate ${category} number ${data.number}`, path);
            });
          }
          return;
        }
        used[category].add(data.number);
      });
    }

    const layerElevations = new Set<number>();
    const layerIds = new Set<string>();
    layers.forEach((layer, index) => {
      const path = `layers[${index}]`;
      const beforeId = errors.length;
      run(`${path}.id`, () => this.requireNonEmptyString(layer.id, `${path}.id`));
      const idIsValid = errors.length === beforeId;
      if (idIsValid) {
        if (layerIds.has(layer.id)) {
          run(`${path}.id`, () => {
            throw new ModelValidationError(`duplicate layer id '${layer.id}'`, `${path}.id`);
          });
        } else {
          layerIds.add(layer.id);
        }
      }
      const beforePosition = errors.length;
      run(`${path}.posZ`, () => this.requireFinite(layer.posZ, `${path}.posZ`));
      const positionIsValid = errors.length === beforePosition;
      if (typeof layer.name !== 'string') {
        run(`${path}.name`, () => {
          throw new ModelValidationError('expected string', `${path}.name`);
        });
      }
      run(`${path}.visible`, () => this.requireBoolean(layer.visible, `${path}.visible`));
      run(`${path}.locked`, () => this.requireBoolean(layer.locked, `${path}.locked`));
      if (positionIsValid) {
        if (layerElevations.has(layer.posZ)) {
          run(`${path}.posZ`, () => {
            throw new ModelValidationError(`duplicate layer elevation ${layer.posZ}`, `${path}.posZ`);
          });
        } else {
          layerElevations.add(layer.posZ);
        }
      }
    });

    return errors;
  }

  static validateLayers(layers: ReadonlyArray<Layer>): void {
    const elevations = new Set<number>();
    const ids = new Set<string>();
    layers.forEach((layer, index) => {
      const path = `layers[${index}]`;
      this.requireNonEmptyString(layer.id, `${path}.id`);
      if (ids.has(layer.id)) {
        throw new ModelValidationError(`duplicate layer id '${layer.id}'`, `${path}.id`);
      }
      ids.add(layer.id);
      this.requireFinite(layer.posZ, `${path}.posZ`);
      if (typeof layer.name !== 'string') {
        throw new ModelValidationError('expected string', `${path}.name`);
      }
      this.requireBoolean(layer.visible, `${path}.visible`);
      this.requireBoolean(layer.locked, `${path}.locked`);
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
    if (node.mass) {
      if (node.mass.values.length !== 6) {
        throw new ModelValidationError('node mass must contain exactly 6 DOF values', `${path}.mass.values`);
      }
      node.mass.values.forEach((value, index) => {
        this.requireFinite(value, `${path}.mass.values[${index}]`);
        if (value < 0)
          throw new ModelValidationError('node mass/inertia must be non-negative', `${path}.mass.values[${index}]`);
      });
      this.requireNonEmptyString(node.mass.translationalUnit, `${path}.mass.translationalUnit`);
      this.requireNonEmptyString(node.mass.rotationalUnit, `${path}.mass.rotationalUnit`);
    }
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
    if (!(member instanceof Spring) && length <= this.MIN_MEMBER_LENGTH) {
      throw new ModelValidationError(`member length must be greater than ${this.MIN_MEMBER_LENGTH}`, path);
    }
    if (typeof member.section !== 'string') {
      throw new ModelValidationError('expected string', `${path}.section`);
    }
    this.requireBoolean(member.isNodeReverse, `${path}.isNodeReverse`);
    if (member instanceof Truss) this.validateTruss(member, path);
    if (member instanceof Spring) this.validateSpring(member, path);
  }

  private static validateTruss(truss: Truss, path: string): void {
    this.requireFinite(truss.area, `${path}.area`);
    if (truss.area <= 0) throw new ModelValidationError('truss area must be greater than 0', `${path}.area`);
    this.requireNonEmptyString(truss.areaUnit, `${path}.areaUnit`);
    if (truss.elasticModulus !== null) {
      this.requireFinite(truss.elasticModulus, `${path}.elasticModulus`);
      if (truss.elasticModulus <= 0) {
        throw new ModelValidationError('elastic modulus must be greater than 0', `${path}.elasticModulus`);
      }
    }
    this.requireNonEmptyString(truss.stressUnit, `${path}.stressUnit`);
    if (typeof truss.material !== 'string') {
      throw new ModelValidationError('expected string', `${path}.material`);
    }
  }

  private static validateSpring(spring: Spring, path: string): void {
    if (spring.components.length === 0) {
      throw new ModelValidationError('spring requires at least one stiffness component', `${path}.components`);
    }
    const dofs = new Set<string>();
    spring.components.forEach((component, index) => {
      const componentPath = `${path}.components[${index}]`;
      if (!isStructuralDof(component.dof)) {
        throw new ModelValidationError(`invalid structural DOF '${String(component.dof)}'`, `${componentPath}.dof`);
      }
      if (dofs.has(component.dof)) {
        throw new ModelValidationError(`duplicate spring DOF '${component.dof}'`, `${componentPath}.dof`);
      }
      dofs.add(component.dof);
      this.requireFinite(component.stiffness, `${componentPath}.stiffness`);
      if (component.stiffness <= 0) {
        throw new ModelValidationError('spring stiffness must be greater than 0', `${componentPath}.stiffness`);
      }
      this.requireNonEmptyString(component.unit, `${componentPath}.unit`);
    });
    if (spring.orientX) this.validateDirection(spring.orientX, `${path}.orientX`);
    if (spring.orientY) this.validateDirection(spring.orientY, `${path}.orientY`);
    if (spring.orientX && spring.orientY) {
      const cross = Point3D.crossProduct(spring.orientX, spring.orientY).length;
      if (cross <= this.MIN_MEMBER_LENGTH) {
        throw new ModelValidationError('spring orientation vectors must not be parallel', `${path}.orientY`);
      }
    }
    if (spring.shearDistance) {
      spring.shearDistance.forEach((value, index) => {
        this.requireFinite(value, `${path}.shearDistance[${index}]`);
        if (value < 0 || value > 1) {
          throw new ModelValidationError(
            'spring shear distance must be between 0 and 1',
            `${path}.shearDistance[${index}]`,
          );
        }
      });
    }
    if (typeof spring.note !== 'string') throw new ModelValidationError('expected string', `${path}.note`);
  }

  private static validateSupport(support: Support, nodes: Set<Node>, path: string): void {
    if (!(support.node instanceof Node) || !nodes.has(support.node)) {
      throw new ModelValidationError('support node does not belong to this Document', `${path}.node`);
    }
    if (support.fixedDofs.length === 0) {
      throw new ModelValidationError('support must restrain at least one DOF', `${path}.fixedDofs`);
    }
    const used = new Set<string>();
    support.fixedDofs.forEach((dof, index) => {
      if (!isStructuralDof(dof)) {
        throw new ModelValidationError(`invalid structural DOF '${String(dof)}'`, `${path}.fixedDofs[${index}]`);
      }
      if (used.has(dof)) {
        throw new ModelValidationError(`duplicate support DOF '${dof}'`, `${path}.fixedDofs[${index}]`);
      }
      used.add(dof);
    });
  }

  private static validateConstraint(constraint: Constraint, nodes: Set<Node>, path: string): void {
    if (constraint.constraintKind !== 'equalDOF') {
      throw new ModelValidationError(
        `unsupported constraint kind '${String(constraint.constraintKind)}'`,
        `${path}.kind`,
      );
    }
    if (!(constraint.slaveNode instanceof Node) || !nodes.has(constraint.slaveNode)) {
      throw new ModelValidationError('constraint slave node does not belong to this Document', `${path}.slaveNode`);
    }
    if (!isStructuralDof(constraint.slaveDof)) {
      throw new ModelValidationError(`invalid structural DOF '${String(constraint.slaveDof)}'`, `${path}.slaveDof`);
    }
    if (constraint.terms.length === 0) {
      throw new ModelValidationError('constraint requires at least one master term', `${path}.terms`);
    }
    const used = new Map<Node, Set<string>>();
    constraint.terms.forEach((term, index) => {
      const termPath = `${path}.terms[${index}]`;
      if (!(term.node instanceof Node) || !nodes.has(term.node)) {
        throw new ModelValidationError('constraint term node does not belong to this Document', `${termPath}.node`);
      }
      if (!isStructuralDof(term.dof)) {
        throw new ModelValidationError(`invalid structural DOF '${String(term.dof)}'`, `${termPath}.dof`);
      }
      this.requireFinite(term.coefficient, `${termPath}.coefficient`);
      if (term.coefficient === 0) {
        throw new ModelValidationError('constraint coefficient must not be zero', `${termPath}.coefficient`);
      }
      const usedDofs = used.get(term.node) ?? new Set<string>();
      if (usedDofs.has(term.dof)) throw new ModelValidationError('duplicate constraint master term', termPath);
      usedDofs.add(term.dof);
      used.set(term.node, usedDofs);
      if (term.node === constraint.slaveNode && term.dof === constraint.slaveDof) {
        throw new ModelValidationError('constraint cannot reference its own slave DOF', termPath);
      }
    });
  }

  private static validateDirection(direction: Point3D, path: string): void {
    this.requireFinite(direction.x, `${path}.x`);
    this.requireFinite(direction.y, `${path}.y`);
    this.requireFinite(direction.z, `${path}.z`);
    if (direction.length <= this.MIN_MEMBER_LENGTH) {
      throw new ModelValidationError('orientation vector must be non-zero', path);
    }
  }

  private static validatePlane(plane: Plane, nodes: Set<Node>, path: string): void {
    const expected =
      plane.kind === 'floor'
        ? { min: 3, text: 'at least 3' }
        : plane.kind === 'wall' || plane.kind === 'bearWall'
          ? { min: 4, max: 4, text: 'exactly 4' }
          : null;
    if (!expected) {
      throw new ModelValidationError(`unsupported plane kind '${plane.kind}'`, path);
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
      constraint: new Set(),
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

  private static requireNonEmptyString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ModelValidationError('expected non-empty string', path);
    }
  }
}

/** ModelValidator.collectModelErrors の関数形式API。 */
export function collectModelErrors(
  dataList: ReadonlyArray<DocumentData>,
  layers: ReadonlyArray<Layer> = [],
  options: ModelValidationOptions = {},
): ModelValidationError[] {
  return ModelValidator.collectModelErrors(dataList, layers, options);
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
