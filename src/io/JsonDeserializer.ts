import { BearWall } from '../data/BearWall';
import { Beam } from '../data/Beam';
import { Document } from '../data/Document';
import type { DocumentData } from '../data/DocumentData';
import { Floor } from '../data/Floor';
import { Node } from '../data/Node';
import { Pillar } from '../data/Pillar';
import { Wall } from '../data/Wall';
import { Point3D } from '../math/Point3D';
import { Layer } from '../data/Layer';
import { parseJsonDocument, type JsonMember, type JsonPlane } from './JsonSchema';
import { decodeImportMetadata } from './ImportMetadataCodec';

export type { JsonDocument, JsonMember } from './JsonSchema';

/** JSON文字列をparse → schema検証 → migration → domain buildしてatomicに読み込む。 */
export function deserializeJson(jsonString: string): void {
  importDocumentJson(jsonString);
}

/** History/draftも利用できる共通import API。 */
export function importDocumentJson(jsonString: string): void {
  const json = parseJsonDocument(jsonString);

  const nodes: Node[] = [];
  const nodeByNumber = new Map<number, Node>();
  json.nodes.forEach((raw) => {
    const node = new Node(new Point3D(raw.pos.x, raw.pos.y, raw.pos.z));
    node.number = raw.number;
    nodeByNumber.set(raw.number, node);
    nodes.push(node);
  });

  const allData: DocumentData[] = [...nodes];
  json.beams.forEach((raw, index) => {
    allData.push(createMember('Beam', raw, nodeByNumber, `beams[${index}]`));
  });
  json.pillars.forEach((raw, index) => {
    allData.push(createMember('Pillar', raw, nodeByNumber, `pillars[${index}]`));
  });
  json.floors.forEach((raw, index) => {
    const floor = new Floor(resolveNodes(raw, nodeByNumber, `floors[${index}]`));
    floor.number = raw.number;
    floor.weight = raw.weight;
    floor.direction = raw.direction;
    if (raw.section !== undefined) floor.section = raw.section;
    allData.push(floor);
  });
  json.walls.forEach((raw, index) => {
    const wall = new Wall(resolveNodes(raw, nodeByNumber, `walls[${index}]`));
    wall.number = raw.number;
    wall.weight = raw.weight;
    if (raw.section !== undefined) wall.section = raw.section;
    allData.push(wall);
  });
  json.bearWalls.forEach((raw, index) => {
    const wall = new BearWall(resolveNodes(raw, nodeByNumber, `bearWalls[${index}]`));
    wall.number = raw.number;
    if (raw.section !== undefined) wall.section = raw.section;
    allData.push(wall);
  });

  const layers = json.layers.map((raw) => new Layer(raw.posZ, raw.name));
  // metadata参照・summary整合性もDocument置換前に解決する。
  const decodedMetadata = json.importMetadata
    ? decodeImportMetadata(json.importMetadata, allData, layers.length)
    : undefined;
  const document = Document.instance;
  document.bulkLoad(allData, layers);
  if (decodedMetadata) {
    decodedMetadata.synchronizeAppNumbers();
    document.setImportMetadata(decodedMetadata.metadata);
  }
}

function resolveNodes(raw: JsonPlane, byNumber: ReadonlyMap<number, Node>, path: string): Node[] {
  return raw.nodes.map((number, index) => {
    const node = byNumber.get(number);
    if (!node) throw new Error(`${path}.nodes[${index}] node not found: ${number}`);
    return node;
  });
}

function createMember(
  type: 'Beam' | 'Pillar',
  raw: JsonMember,
  byNumber: ReadonlyMap<number, Node>,
  path: string,
): Beam | Pillar {
  const rawNodeI = byNumber.get(raw.nodeI);
  const rawNodeJ = byNumber.get(raw.nodeJ);
  if (!rawNodeI || !rawNodeJ) {
    throw new Error(`${path} node not found: ${!rawNodeI ? raw.nodeI : raw.nodeJ}`);
  }

  // 原点に近い方をNodeIにする既存契約を維持する。
  const reverse = rawNodeI.compareTo(rawNodeJ) >= 0;
  const nodeI = reverse ? rawNodeJ : rawNodeI;
  const nodeJ = reverse ? rawNodeI : rawNodeJ;
  const member = type === 'Beam' ? new Beam(nodeI, nodeJ) : new Pillar(nodeI, nodeJ);
  member.number = raw.number;
  member.isNodeReverse = reverse;
  if (raw.section !== undefined) member.section = raw.section;
  return member;
}
