import { DocumentData } from '../data/DocumentData';
import { Node } from '../data/Node';
import { Beam } from '../data/Beam';
import { Pillar } from '../data/Pillar';
import { Floor, FloorDirection } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Document } from '../data/Document';
import { Layer } from '../ui/Layer';
import { Point3D } from '../math/Point3D';

interface JsonNode {
  number: number;
  pos: { x: number; y: number; z: number };
  select: boolean;
}

interface JsonMember {
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
  const parsedUnknown = JSON.parse(jsonString) as unknown;
  if (!isRecord(parsedUnknown)) {
    throw new Error('Invalid JSON document: expected object');
  }

  const parsed = parsedUnknown as Partial<JsonDocument>;
  const json = normalizeDocument(parsed);
  const doc = Document.instance;

  // まずNodeを読み込む（他要素がNodeを参照するため）
  const tempNodes: Node[] = [];
  for (const jn of json.nodes) {
    const node = new Node(new Point3D(jn.pos.x, jn.pos.y, jn.pos.z));
    node.number = jn.number;
    node.select = jn.select;
    tempNodes.push(node);
  }

  const allData: DocumentData[] = [...tempNodes];

  // Beam
  for (const jb of json.beams) {
    const member = createMember('Beam', jb, tempNodes);
    allData.push(member);
  }

  // Pillar
  for (const jp of json.pillars) {
    const member = createMember('Pillar', jp, tempNodes);
    allData.push(member);
  }

  // Floor
  for (const jf of json.floors) {
    const planeNodes = resolveNodes(jf.nodes, tempNodes);
    const floor = new Floor(planeNodes);
    floor.number = jf.number;
    floor.select = jf.select;
    floor.weight = jf.weight;
    floor.direction = (FloorDirection as any)[jf.direction] ?? FloorDirection.X;
    floor.section = jf.section || floor.section;
    allData.push(floor);
  }

  // Wall
  for (const jw of json.walls) {
    const planeNodes = resolveNodes(jw.nodes, tempNodes);
    const wall = new Wall(planeNodes);
    wall.number = jw.number;
    wall.select = jw.select;
    wall.weight = jw.weight;
    wall.section = jw.section || wall.section;
    allData.push(wall);
  }

  // BearWall
  for (const jbw of json.bearWalls) {
    const planeNodes = resolveNodes(jbw.nodes, tempNodes);
    const bearWall = new BearWall(planeNodes);
    bearWall.number = jbw.number;
    bearWall.select = jbw.select;
    bearWall.section = jbw.section || bearWall.section;
    allData.push(bearWall);
  }

  // Layers
  const tempLayers: Layer[] = json.layers.map(jl => new Layer(jl.posZ, jl.name));

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

function findNodeByNumber(nodes: Node[], num: number): Node | null {
  return nodes.find(n => n.number === num) ?? null;
}

function resolveNodes(nodeNums: number[], nodes: Node[]): Node[] {
  const result: Node[] = [];
  for (const num of nodeNums) {
    const n = findNodeByNumber(nodes, num);
    if (!n) {
      throw new Error(`Plane node not found: ${num}`);
    }
    result.push(n);
  }
  return result;
}

function createMember(typeName: string, jm: JsonMember, nodes: Node[]): DocumentData {
  const n1 = findNodeByNumber(nodes, jm.nodeI);
  const n2 = findNodeByNumber(nodes, jm.nodeJ);

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

  let member: Beam | Pillar;
  if (typeName === 'Beam') {
    member = new Beam(nodeI, nodeJ);
    member.section = jm.section || 'G1';
  } else {
    member = new Pillar(nodeI, nodeJ);
    member.section = jm.section || 'C1';
  }

  member.number = jm.number;
  member.select = jm.select;
  member.isNodeReverse = isReverse;
  return member;
}
