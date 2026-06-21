import { DocumentData } from '../data/DocumentData';
import { Node } from '../data/Node';
import { Beam } from '../data/Beam';
import { Pillar } from '../data/Pillar';
import { Floor, parseFloorDirection } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Document } from '../data/Document';
import { Layer } from '../ui/Layer';
import { Point3D } from '../math/Point3D';

/** Plane 種別ごとの最小節点数 */
const MIN_PLANE_NODES = { floor: 3, wall: 2, bearWall: 2 } as const;

interface JsonNode {
  number: number;
  pos: { x: number; y: number; z: number };
  select: boolean;
}

export interface JsonMember {
  number: number;
  nodeI: number;
  nodeJ: number;
  select: boolean;
  section?: string;
}

interface JsonPlane {
  number: number;
  nodes: number[];
  select: boolean;
  section?: string;
}

interface JsonFloor extends JsonPlane {
  weight: number;
  direction: string;
}

interface JsonWall extends JsonPlane {
  weight: number;
}

interface JsonLayer {
  name: string;
  posZ: number;
}

export interface JsonDocument {
  nodes: JsonNode[];
  beams: JsonMember[];
  pillars: JsonMember[];
  floors: JsonFloor[];
  walls: JsonWall[];
  bearWalls: JsonPlane[];
  layers: JsonLayer[];
}

/** JSON文字列からDocumentにデータを読み込む */
export function deserializeJson(jsonString: string): void {
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(jsonString);
  } catch (e) {
    throw new Error('Invalid JSON document: ' + (e as Error).message);
  }
  if (!isRecord(parsedUnknown)) {
    throw new Error('Invalid JSON document: expected object');
  }

  const parsed = parsedUnknown as Partial<JsonDocument>;
  const json = normalizeDocument(parsed);
  const doc = Document.instance;

  // まずNodeを読み込む（他要素がNodeを参照するため）。番号→Nodeのマップで O(1) 解決。
  const tempNodes: Node[] = [];
  const nodeByNumber = new Map<number, Node>();
  json.nodes.forEach((raw, i) => {
    const jn = validateNode(raw, i);
    if (nodeByNumber.has(jn.number)) {
      throw new Error(`Duplicate node number: ${jn.number}`);
    }
    const node = new Node(new Point3D(jn.pos.x, jn.pos.y, jn.pos.z));
    node.number = jn.number;
    node.select = jn.select;
    nodeByNumber.set(jn.number, node);
    tempNodes.push(node);
  });

  const allData: DocumentData[] = [...tempNodes];

  // Beam
  json.beams.forEach((raw, i) => {
    allData.push(createMember('Beam', validateMember(raw, 'beam', i), nodeByNumber));
  });

  // Pillar
  json.pillars.forEach((raw, i) => {
    allData.push(createMember('Pillar', validateMember(raw, 'pillar', i), nodeByNumber));
  });

  // Floor
  json.floors.forEach((raw, i) => {
    const jf = validateFloor(raw, i);
    const floor = new Floor(resolveNodes(jf.nodes, nodeByNumber, MIN_PLANE_NODES.floor, `floor[${i}]`));
    floor.number = jf.number;
    floor.select = jf.select;
    floor.weight = jf.weight;
    floor.direction = parseFloorDirection(jf.direction);
    floor.section = jf.section || floor.section;
    allData.push(floor);
  });

  // Wall
  json.walls.forEach((raw, i) => {
    const jw = validatePlane(raw, 'wall', i);
    const wall = new Wall(resolveNodes(jw.nodes, nodeByNumber, MIN_PLANE_NODES.wall, `wall[${i}]`));
    wall.number = jw.number;
    wall.select = jw.select;
    wall.weight = typeof jw.weight === 'number' ? jw.weight : 0;
    wall.section = jw.section || wall.section;
    allData.push(wall);
  });

  // BearWall
  json.bearWalls.forEach((raw, i) => {
    const jbw = validatePlane(raw, 'bearWall', i);
    const bearWall = new BearWall(resolveNodes(jbw.nodes, nodeByNumber, MIN_PLANE_NODES.bearWall, `bearWall[${i}]`));
    bearWall.number = jbw.number;
    bearWall.select = jbw.select;
    bearWall.section = jbw.section || bearWall.section;
    allData.push(bearWall);
  });

  // Layers
  const tempLayers: Layer[] = json.layers.map((raw, i) => {
    const jl = validateLayer(raw, i);
    return new Layer(jl.posZ, jl.name);
  });

  doc.bulkLoad(allData, tempLayers);
}

function normalizeDocument(json: Partial<JsonDocument>): JsonDocument {
  return {
    nodes: ensureRequiredArray(json.nodes, 'nodes'),
    beams: ensureArray(json.beams, 'beams'),
    pillars: ensureArray(json.pillars, 'pillars'),
    floors: ensureArray(json.floors, 'floors'),
    walls: ensureArray(json.walls, 'walls'),
    bearWalls: ensureArray(json.bearWalls, 'bearWalls'),
    layers: ensureArray(json.layers, 'layers'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureRequiredArray<T>(value: T[] | undefined, fieldName: string): T[] {
  if (value === undefined) {
    throw new Error(`Invalid JSON field '${fieldName}': required array`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid JSON field '${fieldName}': expected array`);
  }
  return value;
}

function ensureArray<T>(value: T[] | undefined, fieldName: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Invalid JSON field '${fieldName}': expected array`);
  }
  return value;
}

function resolveNodes(nodeNums: number[], byNumber: Map<number, Node>, min: number, label: string): Node[] {
  if (nodeNums.length < min) {
    throw new Error(`${label} requires at least ${min} nodes, got ${nodeNums.length}`);
  }
  return nodeNums.map((num) => {
    const n = byNumber.get(num);
    if (!n) throw new Error(`${label} node not found: ${num}`);
    return n;
  });
}

type MemberType = 'Beam' | 'Pillar';

function createMember(typeName: MemberType, jm: JsonMember, byNumber: Map<number, Node>): DocumentData {
  const n1 = byNumber.get(jm.nodeI);
  const n2 = byNumber.get(jm.nodeJ);

  if (!n1 || !n2) {
    throw new Error(`Member node not found: NodeI=${jm.nodeI}, NodeJ=${jm.nodeJ}`);
  }

  // 原点に近い方をNodeIにする
  let nodeI: Node, nodeJ: Node;
  let isReverse = false;
  if (n1.compareTo(n2) < 0) {
    nodeI = n1;
    nodeJ = n2;
  } else {
    nodeI = n2;
    nodeJ = n1;
    isReverse = true;
  }

  // section 既定値はクラス側のコンストラクタが持つため、未指定時はそれを尊重する
  const member: Beam | Pillar = typeName === 'Beam'
    ? new Beam(nodeI, nodeJ)
    : new Pillar(nodeI, nodeJ);
  if (jm.section) member.section = jm.section;

  member.number = jm.number;
  member.select = jm.select;
  member.isNodeReverse = isReverse;
  return member;
}

// ========== 要素レベルのバリデーション（I-2） ==========

function asRecord(v: unknown, label: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`Invalid ${label}: expected object`);
  return v;
}

function asNumber(v: unknown, label: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`Invalid ${label}: expected number`);
  return v;
}

function asNumberArray(v: unknown, label: string): number[] {
  if (!Array.isArray(v)) throw new Error(`Invalid ${label}: expected number array`);
  return v.map((x, i) => asNumber(x, `${label}[${i}]`));
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function validateNode(raw: unknown, i: number): JsonNode {
  const r = asRecord(raw, `node[${i}]`);
  const pos = asRecord(r.pos, `node[${i}].pos`);
  return {
    number: asNumber(r.number, `node[${i}].number`),
    pos: {
      x: asNumber(pos.x, `node[${i}].pos.x`),
      y: asNumber(pos.y, `node[${i}].pos.y`),
      z: asNumber(pos.z, `node[${i}].pos.z`),
    },
    select: r.select === true,
  };
}

function validateMember(raw: unknown, kind: string, i: number): JsonMember {
  const r = asRecord(raw, `${kind}[${i}]`);
  return {
    number: asNumber(r.number, `${kind}[${i}].number`),
    nodeI: asNumber(r.nodeI, `${kind}[${i}].nodeI`),
    nodeJ: asNumber(r.nodeJ, `${kind}[${i}].nodeJ`),
    select: r.select === true,
    section: optString(r.section),
  };
}

function validatePlane(raw: unknown, kind: string, i: number): JsonWall {
  const r = asRecord(raw, `${kind}[${i}]`);
  return {
    number: asNumber(r.number, `${kind}[${i}].number`),
    nodes: asNumberArray(r.nodes, `${kind}[${i}].nodes`),
    select: r.select === true,
    section: optString(r.section),
    weight: typeof r.weight === 'number' ? r.weight : 0,
  };
}

function validateFloor(raw: unknown, i: number): JsonFloor {
  const plane = validatePlane(raw, 'floor', i);
  const r = raw as Record<string, unknown>;
  return {
    ...plane,
    weight: typeof r.weight === 'number' ? r.weight : 0,
    direction: optString(r.direction) ?? 'X',
  };
}

function validateLayer(raw: unknown, i: number): JsonLayer {
  const r = asRecord(raw, `layer[${i}]`);
  return {
    name: optString(r.name) ?? '',
    posZ: asNumber(r.posZ, `layer[${i}].posZ`),
  };
}
