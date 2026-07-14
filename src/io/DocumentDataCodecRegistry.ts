import { Beam } from '../data/Beam';
import { BearWall } from '../data/BearWall';
import { Constraint } from '../data/Constraint';
import type { DocumentData, DocumentDataKind } from '../data/DocumentData';
import { Floor, FloorDirection } from '../data/Floor';
import { Node } from '../data/Node';
import { Pillar } from '../data/Pillar';
import { Spring } from '../data/Spring';
import { STRUCTURAL_DOFS, cloneNodeMass, isStructuralDof, type DofVector6 } from '../data/StructuralDof';
import { Support } from '../data/Support';
import { Truss } from '../data/Truss';
import { Wall } from '../data/Wall';
import { Point3D } from '../math/Point3D';
import { TYPE_REGISTRY, typeEntryForKind, type NumberCategory } from '../data/typeRegistry';
import type {
  JsonConstraint,
  JsonDataCollections,
  JsonFloor,
  JsonMember,
  JsonNode,
  JsonPlane,
  JsonSpring,
  JsonSupport,
  JsonTruss,
  JsonWall,
} from './JsonSchema';
import {
  asFiniteNumber,
  asId,
  asIdArray,
  asRecord,
  asString,
  optionalArray,
  optionalBoolean,
  optionalFiniteNumber,
  optionalString,
  requiredArray,
  validateLegacySelection,
  type UnknownRecord,
} from './JsonValueValidation';

type CollectionKey = keyof JsonDataCollections;
type JsonDataRow = JsonDataCollections[CollectionKey][number];

interface BuildContext {
  nodesByNumber: ReadonlyMap<number, Node>;
}

interface CodecValidationOptions {
  strictV2: boolean;
}

interface DocumentDataCodec<TData extends DocumentData = DocumentData, TRaw extends JsonDataRow = JsonDataRow> {
  kind: DocumentDataKind;
  ctor: abstract new (...args: any[]) => TData;
  category: NumberCategory;
  collection: CollectionKey;
  validate(raw: unknown, index: number, options: CodecValidationOptions): TRaw;
  serialize(data: TData): TRaw;
  deserialize(raw: TRaw, context: BuildContext): TData;
  cloneWithNodes(data: TData, nodeMap: Map<Node, Node>): TData;
}

function codec<TData extends DocumentData, TRaw extends JsonDataRow>(
  value: DocumentDataCodec<TData, TRaw>,
): DocumentDataCodec<TData, TRaw> {
  return value;
}

/** TYPE_REGISTRYのconstructorをcodecの具体型へ安全に絞る唯一の型境界。 */
function codecType<TData extends DocumentData>(
  kind: TData['kind'],
): Pick<DocumentDataCodec<TData>, 'kind' | 'ctor' | 'category'> {
  return typeEntryForKind(kind) as Pick<DocumentDataCodec<TData>, 'kind' | 'ctor' | 'category'>;
}

const DOCUMENT_DATA_CODEC_DEFINITIONS: readonly DocumentDataCodec[] = [
  codec<Node, JsonNode>({
    ...codecType<Node>('node'),
    collection: 'nodes',
    validate: validateNode,
    serialize: (node) => ({
      number: node.number,
      pos: { x: node.pos.x, y: node.pos.y, z: node.pos.z },
      mass: node.mass
        ? {
            values: [...node.mass.values] as DofVector6,
            translationalUnit: node.mass.translationalUnit,
            rotationalUnit: node.mass.rotationalUnit,
          }
        : undefined,
    }),
    deserialize: (raw) => {
      const node = new Node(new Point3D(raw.pos.x, raw.pos.y, raw.pos.z));
      node.number = raw.number;
      node.mass = raw.mass
        ? {
            values: [...raw.mass.values] as DofVector6,
            translationalUnit: raw.mass.translationalUnit,
            rotationalUnit: raw.mass.rotationalUnit,
          }
        : null;
      return node;
    },
    cloneWithNodes: (node, nodeMap) => {
      const existing = nodeMap.get(node);
      if (existing) return existing;
      const copy = new Node(node.pos);
      copy.mass = cloneNodeMass(node.mass);
      nodeMap.set(node, copy);
      return copy;
    },
  }),
  memberCodec<Beam>('beam', 'beams'),
  memberCodec<Pillar>('pillar', 'pillars'),
  codec<Truss, JsonTruss>({
    ...codecType<Truss>('truss'),
    collection: 'trusses',
    validate: validateTruss,
    serialize: (truss) => ({
      ...serializeMember(truss),
      material: truss.material || undefined,
      area: truss.area,
      areaUnit: truss.areaUnit,
      elasticModulus: truss.elasticModulus ?? undefined,
      stressUnit: truss.stressUnit,
    }),
    deserialize: (raw, context) => {
      const truss = new Truss(
        resolveNode(raw.nodeI, context, 'trusses.nodeI'),
        resolveNode(raw.nodeJ, context, 'trusses.nodeJ'),
      );
      applyMemberFields(truss, raw);
      truss.material = raw.material ?? '';
      truss.area = raw.area;
      truss.areaUnit = raw.areaUnit;
      truss.elasticModulus = raw.elasticModulus ?? null;
      truss.stressUnit = raw.stressUnit;
      return truss;
    },
    cloneWithNodes: (truss, nodeMap) => {
      const copy = new Truss(
        clonedEndpoint(truss.nodeI, nodeMap, 'nodeI'),
        clonedEndpoint(truss.nodeJ, nodeMap, 'nodeJ'),
      );
      copyMemberFields(copy, truss);
      copy.material = truss.material;
      copy.area = truss.area;
      copy.areaUnit = truss.areaUnit;
      copy.elasticModulus = truss.elasticModulus;
      copy.stressUnit = truss.stressUnit;
      return copy;
    },
  }),
  codec<Spring, JsonSpring>({
    ...codecType<Spring>('spring'),
    collection: 'springs',
    validate: validateSpring,
    serialize: (spring) => ({
      ...serializeMember(spring),
      components: spring.components.map((component) => ({ ...component })),
      orientX: spring.orientX ? pointToJson(spring.orientX) : undefined,
      orientY: spring.orientY ? pointToJson(spring.orientY) : undefined,
      shearDistance: spring.shearDistance ? [...spring.shearDistance] : undefined,
      note: spring.note || undefined,
    }),
    deserialize: (raw, context) => {
      const spring = new Spring(
        resolveNode(raw.nodeI, context, 'springs.nodeI'),
        resolveNode(raw.nodeJ, context, 'springs.nodeJ'),
      );
      applyMemberFields(spring, raw);
      spring.components = raw.components.map((component) => ({ ...component }));
      spring.orientX = raw.orientX ? jsonToPoint(raw.orientX) : null;
      spring.orientY = raw.orientY ? jsonToPoint(raw.orientY) : null;
      spring.shearDistance = raw.shearDistance ? [...raw.shearDistance] : null;
      spring.note = raw.note ?? '';
      return spring;
    },
    cloneWithNodes: (spring, nodeMap) => {
      const copy = new Spring(
        clonedEndpoint(spring.nodeI, nodeMap, 'nodeI'),
        clonedEndpoint(spring.nodeJ, nodeMap, 'nodeJ'),
      );
      copyMemberFields(copy, spring);
      copy.components = spring.components.map((component) => ({ ...component }));
      copy.orientX = spring.orientX?.clone() ?? null;
      copy.orientY = spring.orientY?.clone() ?? null;
      copy.shearDistance = spring.shearDistance ? [...spring.shearDistance] : null;
      copy.note = spring.note;
      return copy;
    },
  }),
  planeCodec<BearWall>('bearWall', 'bearWalls'),
  codec<Wall, JsonWall>({
    ...planeCodec<Wall>('wall', 'walls'),
    validate: validateWall,
    serialize: (wall) => ({ ...serializePlane(wall), weight: wall.weight }),
    deserialize: (raw, context) => {
      const wall = new Wall(resolvePlaneNodes(raw, context, 'walls'));
      applyPlaneFields(wall, raw);
      wall.weight = raw.weight;
      return wall;
    },
    cloneWithNodes: (wall, nodeMap) => {
      const copy = new Wall(wall.nodeList.map((node) => clonedEndpoint(node, nodeMap, 'wall node')));
      copyPlaneFields(copy, wall);
      copy.weight = wall.weight;
      return copy;
    },
  }),
  codec<Floor, JsonFloor>({
    ...planeCodec<Floor>('floor', 'floors'),
    validate: validateFloor,
    serialize: (floor) => ({
      ...serializePlane(floor),
      weight: floor.weight,
      direction: floor.direction,
    }),
    deserialize: (raw, context) => {
      const floor = new Floor(resolvePlaneNodes(raw, context, 'floors'));
      applyPlaneFields(floor, raw);
      floor.weight = raw.weight;
      floor.direction = raw.direction;
      return floor;
    },
    cloneWithNodes: (floor, nodeMap) => {
      const copy = new Floor(floor.nodeList.map((node) => clonedEndpoint(node, nodeMap, 'floor node')));
      copyPlaneFields(copy, floor);
      copy.weight = floor.weight;
      copy.direction = floor.direction;
      return copy;
    },
  }),
  codec<Support, JsonSupport>({
    ...codecType<Support>('support'),
    collection: 'supports',
    validate: validateSupport,
    serialize: (support) => ({
      number: support.number,
      node: requiredNodeNumber(support.node, 'support.node'),
      fixedDofs: [...support.fixedDofs],
    }),
    deserialize: (raw, context) => {
      const support = new Support(resolveNode(raw.node, context, 'supports.node'), raw.fixedDofs);
      support.number = raw.number;
      return support;
    },
    cloneWithNodes: (support, nodeMap) => {
      const copy = new Support(clonedEndpoint(support.node, nodeMap, 'support node'), support.fixedDofs);
      return copy;
    },
  }),
  codec<Constraint, JsonConstraint>({
    ...codecType<Constraint>('constraint'),
    collection: 'constraints',
    validate: validateConstraint,
    serialize: (constraint) => ({
      number: constraint.number,
      kind: constraint.constraintKind,
      slave: {
        node: requiredNodeNumber(constraint.slaveNode, 'constraint.slave.node'),
        dof: constraint.slaveDof,
      },
      terms: constraint.terms.map((term) => ({
        node: requiredNodeNumber(term.node, 'constraint.term.node'),
        dof: term.dof,
        coefficient: term.coefficient,
      })),
    }),
    deserialize: (raw, context) => {
      const constraint = new Constraint(
        resolveNode(raw.slave.node, context, 'constraints.slave.node'),
        raw.slave.dof,
        raw.terms.map((term) => ({
          node: resolveNode(term.node, context, 'constraints.terms.node'),
          dof: term.dof,
          coefficient: term.coefficient,
        })),
      );
      constraint.number = raw.number;
      constraint.constraintKind = raw.kind;
      return constraint;
    },
    cloneWithNodes: (constraint, nodeMap) => {
      const copy = new Constraint(
        clonedEndpoint(constraint.slaveNode, nodeMap, 'constraint slave'),
        constraint.slaveDof,
        constraint.terms.map((term) => ({
          node: clonedEndpoint(term.node, nodeMap, 'constraint term'),
          dof: term.dof,
          coefficient: term.coefficient,
        })),
      );
      copy.constraintKind = constraint.constraintKind;
      return copy;
    },
  }),
] as readonly DocumentDataCodec[];

/**
 * data層のregistryを唯一の順序・constructor・採番カテゴリ定義として使う。
 * codecの追加漏れ、重複、誤ったconstructorはmodule初期化時に即座に拒否する。
 */
export const DOCUMENT_DATA_CODECS: readonly DocumentDataCodec[] = TYPE_REGISTRY.map((typeEntry) => {
  const matches = DOCUMENT_DATA_CODEC_DEFINITIONS.filter((candidate) => candidate.kind === typeEntry.kind);
  if (matches.length !== 1) {
    throw new Error(`DocumentData kind '${typeEntry.kind}' must have exactly one codec (found ${matches.length})`);
  }
  const registered = matches[0];
  if (registered.ctor !== typeEntry.ctor || registered.category !== typeEntry.category) {
    throw new Error(`Codec metadata for DocumentData kind '${typeEntry.kind}' does not match TYPE_REGISTRY`);
  }
  return registered;
});

if (DOCUMENT_DATA_CODEC_DEFINITIONS.length !== TYPE_REGISTRY.length) {
  throw new Error('DocumentData codec registry contains an unregistered or duplicate definition');
}

export function validateDocumentDataCollections(
  root: UnknownRecord,
  options: CodecValidationOptions = { strictV2: false },
): JsonDataCollections {
  const result = emptyJsonDataCollections();
  for (const entry of DOCUMENT_DATA_CODECS) {
    const rawRows =
      entry.collection === 'nodes' || options.strictV2
        ? requiredArray(root[entry.collection], entry.collection)
        : optionalArray(root[entry.collection], entry.collection);
    (result[entry.collection] as JsonDataRow[]) = rawRows.map((raw, index) => entry.validate(raw, index, options));
  }

  const used: Record<NumberCategory, Set<number>> = {
    node: new Set(),
    member: new Set(),
    plane: new Set(),
    constraint: new Set(),
  };
  for (const entry of DOCUMENT_DATA_CODECS) {
    for (const [index, raw] of result[entry.collection].entries()) {
      if (used[entry.category].has(raw.number)) {
        throw new Error(`Duplicate ${entry.category} number at ${entry.collection}[${index}]: ${raw.number}`);
      }
      used[entry.category].add(raw.number);
    }
  }
  return result;
}

export function serializeDocumentData(dataList: ReadonlyArray<DocumentData>): JsonDataCollections {
  const result = emptyJsonDataCollections();
  for (const data of dataList) {
    const entry = codecForData(data);
    (result[entry.collection] as JsonDataRow[]).push(entry.serialize(data) as JsonDataRow);
  }
  return result;
}

export function deserializeDocumentData(collections: JsonDataCollections): DocumentData[] {
  const nodeCodec = DOCUMENT_DATA_CODECS.find((entry) => entry.kind === 'node')!;
  const nodes = collections.nodes.map((raw) => nodeCodec.deserialize(raw, { nodesByNumber: new Map() }) as Node);
  const nodesByNumber = new Map(nodes.map((node) => [node.number, node] as const));
  const context: BuildContext = { nodesByNumber };
  const all: DocumentData[] = [...nodes];
  for (const entry of DOCUMENT_DATA_CODECS) {
    if (entry.kind === 'node') continue;
    for (const raw of collections[entry.collection]) all.push(entry.deserialize(raw, context));
  }
  return all;
}

/** Layer copy等で全登録型を同じregistryから複製する。選択状態とnumberは複製しない。 */
export function cloneWithNodes<T extends DocumentData>(data: T, nodeMap: Map<Node, Node>): T {
  const copy = codecForData(data).cloneWithNodes(data, nodeMap) as T;
  copy.number = 0;
  copy.select = false;
  return copy;
}

function codecForData(data: DocumentData): DocumentDataCodec {
  const entry = DOCUMENT_DATA_CODECS.find(
    (candidate) => candidate.kind === data.kind && data.constructor === candidate.ctor,
  );
  if (!entry) throw new Error(`Cannot serialize unsupported DocumentData kind '${data.kind}'`);
  return entry;
}

function emptyJsonDataCollections(): JsonDataCollections {
  return {
    nodes: [],
    beams: [],
    pillars: [],
    trusses: [],
    springs: [],
    floors: [],
    walls: [],
    bearWalls: [],
    supports: [],
    constraints: [],
  };
}

function memberCodec<T extends Beam | Pillar>(
  kind: T['kind'],
  collection: 'beams' | 'pillars',
): DocumentDataCodec<T, JsonMember> {
  const registration = codecType<T>(kind);
  const ctor = registration.ctor as new (nodeI?: Node, nodeJ?: Node) => T;
  return codec<T, JsonMember>({
    ...registration,
    collection,
    validate: (raw, index) => validateMember(raw, index, collection),
    serialize: (member) => serializeMember(member),
    deserialize: (raw, context) => {
      const member = new ctor(
        resolveNode(raw.nodeI, context, `${collection}.nodeI`),
        resolveNode(raw.nodeJ, context, `${collection}.nodeJ`),
      );
      applyMemberFields(member, raw);
      return member;
    },
    cloneWithNodes: (member, nodeMap) => {
      const copy = new ctor(
        clonedEndpoint(member.nodeI, nodeMap, 'nodeI'),
        clonedEndpoint(member.nodeJ, nodeMap, 'nodeJ'),
      );
      copyMemberFields(copy, member);
      return copy;
    },
  });
}

function planeCodec<T extends BearWall | Wall | Floor>(
  kind: T['kind'],
  collection: 'bearWalls' | 'walls' | 'floors',
): DocumentDataCodec<T, JsonPlane> {
  const registration = codecType<T>(kind);
  const ctor = registration.ctor as new (nodes?: Node[]) => T;
  return codec<T, JsonPlane>({
    ...registration,
    collection,
    validate: (raw, index) => validatePlane(raw, index, collection),
    serialize: (plane) => serializePlane(plane),
    deserialize: (raw, context) => {
      const plane = new ctor(resolvePlaneNodes(raw, context, collection));
      applyPlaneFields(plane, raw);
      return plane;
    },
    cloneWithNodes: (plane, nodeMap) => {
      const copy = new ctor(plane.nodeList.map((node) => clonedEndpoint(node, nodeMap, 'plane node')));
      copyPlaneFields(copy, plane);
      return copy;
    },
  });
}

function validateNode(raw: unknown, index: number): JsonNode {
  // Keep the legacy singular path in validation errors for callers that match
  // these messages, even though the JSON collection itself is named `nodes`.
  const path = `node[${index}]`;
  const row = asRecord(raw, path);
  validateLegacySelection(row.select, `${path}.select`);
  const pos = asRecord(row.pos, `${path}.pos`);
  let mass: JsonNode['mass'];
  if (row.mass !== undefined) {
    const massRow = asRecord(row.mass, `${path}.mass`);
    if (!Array.isArray(massRow.values) || massRow.values.length !== 6) {
      throw new Error(`Invalid ${path}.mass.values: expected 6 finite numbers`);
    }
    mass = {
      values: massRow.values.map((value, dof) => asFiniteNumber(value, `${path}.mass.values[${dof}]`)) as DofVector6,
      translationalUnit: asString(massRow.translationalUnit, `${path}.mass.translationalUnit`),
      rotationalUnit: asString(massRow.rotationalUnit, `${path}.mass.rotationalUnit`),
    };
  }
  return {
    number: asId(row.number, `${path}.number`),
    pos: {
      x: asFiniteNumber(pos.x, `${path}.pos.x`),
      y: asFiniteNumber(pos.y, `${path}.pos.y`),
      z: asFiniteNumber(pos.z, `${path}.pos.z`),
    },
    mass,
  };
}

function validateMember(raw: unknown, index: number, collection: string): JsonMember {
  const path = `${collection}[${index}]`;
  const row = asRecord(raw, path);
  validateLegacySelection(row.select, `${path}.select`);
  return {
    number: asId(row.number, `${path}.number`),
    nodeI: asId(row.nodeI, `${path}.nodeI`),
    nodeJ: asId(row.nodeJ, `${path}.nodeJ`),
    section: optionalString(row.section, `${path}.section`),
    isNodeReverse: optionalBoolean(row.isNodeReverse, `${path}.isNodeReverse`),
  };
}

function validateTruss(raw: unknown, index: number): JsonTruss {
  const path = `trusses[${index}]`;
  const row = asRecord(raw, path);
  return {
    ...validateMember(row, index, 'trusses'),
    material: optionalString(row.material, `${path}.material`),
    area: asFiniteNumber(row.area, `${path}.area`),
    areaUnit: asString(row.areaUnit, `${path}.areaUnit`),
    elasticModulus: optionalFiniteNumber(row.elasticModulus, `${path}.elasticModulus`),
    stressUnit: asString(row.stressUnit, `${path}.stressUnit`),
  };
}

function validateSpring(raw: unknown, index: number): JsonSpring {
  const path = `springs[${index}]`;
  const row = asRecord(raw, path);
  const components = requiredArray(row.components, `${path}.components`).map((value, componentIndex) => {
    const componentPath = `${path}.components[${componentIndex}]`;
    const component = asRecord(value, componentPath);
    const dof = asString(component.dof, `${componentPath}.dof`);
    if (!isStructuralDof(dof))
      throw new Error(`Invalid ${componentPath}.dof: expected one of ${STRUCTURAL_DOFS.join(', ')}`);
    return {
      dof,
      stiffness: asFiniteNumber(component.stiffness, `${componentPath}.stiffness`),
      unit: asString(component.unit, `${componentPath}.unit`),
    };
  });
  return {
    ...validateMember(row, index, 'springs'),
    components,
    orientX: optionalPoint(row.orientX, `${path}.orientX`),
    orientY: optionalPoint(row.orientY, `${path}.orientY`),
    shearDistance: optionalPair(row.shearDistance, `${path}.shearDistance`),
    note: optionalString(row.note, `${path}.note`),
  };
}

function validatePlane(raw: unknown, index: number, collection: string): JsonPlane {
  const path = `${collection}[${index}]`;
  const row = asRecord(raw, path);
  validateLegacySelection(row.select, `${path}.select`);
  return {
    number: asId(row.number, `${path}.number`),
    nodes: asIdArray(row.nodes, `${path}.nodes`),
    section: optionalString(row.section, `${path}.section`),
  };
}

function validateFloor(raw: unknown, index: number, options: CodecValidationOptions): JsonFloor {
  const path = `floors[${index}]`;
  const row = asRecord(raw, path);
  const direction = optionalString(row.direction, `${path}.direction`) ?? FloorDirection.X;
  const isKnownDirection = (Object.values(FloorDirection) as string[]).includes(direction);
  if (options.strictV2 && (row.weight === undefined || row.direction === undefined || !isKnownDirection)) {
    throw new Error(`Invalid ${path}: schema v2 requires weight and a valid direction`);
  }
  return {
    ...validatePlane(row, index, 'floors'),
    weight: optionalFiniteNumber(row.weight, `${path}.weight`) ?? 0,
    direction: isKnownDirection ? (direction as FloorDirection) : FloorDirection.X,
  };
}

function validateWall(raw: unknown, index: number, options: CodecValidationOptions): JsonWall {
  const row = asRecord(raw, `walls[${index}]`);
  if (options.strictV2 && row.weight === undefined) {
    throw new Error(`Invalid walls[${index}].weight: required by schema v2`);
  }
  return {
    ...validatePlane(row, index, 'walls'),
    weight: optionalFiniteNumber(row.weight, `walls[${index}].weight`) ?? 0,
  };
}

function validateSupport(raw: unknown, index: number): JsonSupport {
  const path = `supports[${index}]`;
  const row = asRecord(raw, path);
  const fixedDofs = readDofs(row.fixedDofs, `${path}.fixedDofs`);
  return {
    number: asId(row.number, `${path}.number`),
    node: asId(row.node, `${path}.node`),
    fixedDofs,
  };
}

function validateConstraint(raw: unknown, index: number): JsonConstraint {
  const path = `constraints[${index}]`;
  const row = asRecord(raw, path);
  const kind = asString(row.kind, `${path}.kind`);
  if (kind !== 'equalDOF') throw new Error(`Invalid ${path}.kind: expected 'equalDOF'`);
  const slave = asRecord(row.slave, `${path}.slave`);
  const slaveDof = asString(slave.dof, `${path}.slave.dof`);
  if (!isStructuralDof(slaveDof)) throw new Error(`Invalid ${path}.slave.dof`);
  const terms = requiredArray(row.terms, `${path}.terms`).map((value, termIndex) => {
    const termPath = `${path}.terms[${termIndex}]`;
    const term = asRecord(value, termPath);
    const dof = asString(term.dof, `${termPath}.dof`);
    if (!isStructuralDof(dof)) throw new Error(`Invalid ${termPath}.dof`);
    return {
      node: asId(term.node, `${termPath}.node`),
      dof,
      coefficient: asFiniteNumber(term.coefficient, `${termPath}.coefficient`),
    };
  });
  return {
    number: asId(row.number, `${path}.number`),
    kind,
    slave: { node: asId(slave.node, `${path}.slave.node`), dof: slaveDof },
    terms,
  };
}

function serializeMember(member: Beam | Pillar | Truss | Spring): JsonMember {
  return {
    number: member.number,
    nodeI: requiredNodeNumber(member.nodeI, `${member.kind}.nodeI`),
    nodeJ: requiredNodeNumber(member.nodeJ, `${member.kind}.nodeJ`),
    section: member.section || undefined,
    isNodeReverse: member.isNodeReverse || undefined,
  };
}

function applyMemberFields(member: Beam | Pillar | Truss | Spring, raw: JsonMember): void {
  member.number = raw.number;
  member.section = raw.section ?? member.section;
  member.isNodeReverse = raw.isNodeReverse ?? false;
}

function copyMemberFields(target: Beam | Pillar | Truss | Spring, source: Beam | Pillar | Truss | Spring): void {
  target.section = source.section;
  target.isNodeReverse = source.isNodeReverse;
}

function serializePlane(plane: BearWall | Wall | Floor): JsonPlane {
  return {
    number: plane.number,
    nodes: plane.nodeList.map((node) => requiredNodeNumber(node, `${plane.kind}.nodes`)),
    section: plane.section || undefined,
  };
}

function applyPlaneFields(plane: BearWall | Wall | Floor, raw: JsonPlane): void {
  plane.number = raw.number;
  plane.section = raw.section ?? plane.section;
}

function copyPlaneFields(target: BearWall | Wall | Floor, source: BearWall | Wall | Floor): void {
  target.section = source.section;
}

function resolvePlaneNodes(raw: JsonPlane, context: BuildContext, path: string): Node[] {
  return raw.nodes.map((number, index) => resolveNode(number, context, `${path}.nodes[${index}]`));
}

function resolveNode(number: number, context: BuildContext, path: string): Node {
  const node = context.nodesByNumber.get(number);
  if (!node) throw new Error(`${path} node not found: ${number}`);
  return node;
}

function requiredNodeNumber(node: Node | null, path: string): number {
  if (!node) throw new Error(`Cannot serialize ${path}: node is missing`);
  return node.number;
}

function clonedEndpoint(node: Node | null, nodeMap: ReadonlyMap<Node, Node>, path: string): Node {
  if (!node) throw new Error(`Cannot clone ${path}: source node is missing`);
  const cloned = nodeMap.get(node);
  if (!cloned) throw new Error(`Cannot clone ${path}: nodeMap has no entry for Node ${node.number}`);
  return cloned;
}

function readDofs(value: unknown, path: string): (typeof STRUCTURAL_DOFS)[number][] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${path}: expected DOF array`);
  return value.map((item, index) => {
    const dof = asString(item, `${path}[${index}]`);
    if (!isStructuralDof(dof)) throw new Error(`Invalid ${path}[${index}]: unknown DOF '${dof}'`);
    return dof;
  });
}

function optionalPoint(value: unknown, path: string): { x: number; y: number; z: number } | undefined {
  if (value === undefined) return undefined;
  const row = asRecord(value, path);
  return {
    x: asFiniteNumber(row.x, `${path}.x`),
    y: asFiniteNumber(row.y, `${path}.y`),
    z: asFiniteNumber(row.z, `${path}.z`),
  };
}

function optionalPair(value: unknown, path: string): [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`Invalid ${path}: expected two numbers`);
  return [asFiniteNumber(value[0], `${path}[0]`), asFiniteNumber(value[1], `${path}[1]`)];
}

function pointToJson(point: Point3D): { x: number; y: number; z: number } {
  return { x: point.x, y: point.y, z: point.z };
}

function jsonToPoint(point: { x: number; y: number; z: number }): Point3D {
  return new Point3D(point.x, point.y, point.z);
}
