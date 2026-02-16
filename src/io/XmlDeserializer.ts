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

/** classname → 型名の正規化マップ */
const CLASS_MAP: Record<string, string> = {
  'FrameModeller.Data.Node': 'Node',
  'Ebi_FrameModeler.Data.Node': 'Node',
  'FrameModeller.Data.Beam': 'Beam',
  'Ebi_FrameModeler.Data.Beam': 'Beam',
  'FrameModeller.Data.Pillar': 'Pillar',
  'Ebi_FrameModeler.Data.Pillar': 'Pillar',
  'FrameModeller.Data.Floor': 'Floor',
  'Ebi_FrameModeler.Data.Floor': 'Floor',
  'FrameModeller.Data.Wall': 'Wall',
  'Ebi_FrameModeler.Data.Wall': 'Wall',
  'FrameModeller.Data.BearWall': 'BearWall',
  'Ebi_FrameModeler.Data.BearWall': 'BearWall',
  'FrameModeller.UI.Layer': 'Layer',
  'Ebi_FrameModeler.UI.Layer': 'Layer',
  'Ebi_FrameModeler.Data.FrameType': 'FrameType',
};

/** XMLElement から子要素の値を読むヘルパー */
function readChild(elem: Element, name: string, defaultValue: string = ''): string {
  const children = elem.getElementsByTagName(name);
  if (children.length === 0) return defaultValue;
  return children[0].textContent ?? defaultValue;
}

/** XML文字列からDocumentにデータを読み込む */
export function deserializeXml(xmlString: string): void {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
  const root = xmlDoc.documentElement;

  if (!root) throw new Error('XML root element not found');

  const doc = Document.instance;
  doc.init();

  // まずNodeを読み込む（他要素がNodeを参照するため）
  const tempNodes: Node[] = [];
  const tempMembers: DocumentData[] = [];
  const tempPlanes: { type: string; elem: Element }[] = [];
  const tempLayers: Layer[] = [];

  const objectElems = root.getElementsByTagName('object');

  for (let i = 0; i < objectElems.length; i++) {
    const elem = objectElems[i];
    const classname = elem.getAttribute('classname') ?? '';
    const typeName = CLASS_MAP[classname];

    if (!typeName) continue;

    if (typeName === 'FrameType') continue; // スキップ

    if (typeName === 'Node') {
      const node = new Node();
      const reader = (name: string, defaultValue?: string) => readChild(elem, name, defaultValue);
      node.load(reader);
      tempNodes.push(node);
    } else if (typeName === 'Layer') {
      const name = readChild(elem, 'Name', 'レイヤー');
      const posZ = parseFloat(readChild(elem, 'PosZ', '0'));
      tempLayers.push(new Layer(posZ, name));
    } else if (typeName === 'Beam' || typeName === 'Pillar') {
      tempMembers.push(createMember(typeName, elem, tempNodes));
    } else {
      tempPlanes.push({ type: typeName, elem });
    }
  }

  // Plane系要素の読込（Nodeが全て揃った後）
  const allData: DocumentData[] = [...tempNodes];

  for (const m of tempMembers) {
    allData.push(m);
  }

  for (const { type, elem } of tempPlanes) {
    const plane = createPlane(type, elem, tempNodes);
    if (plane) allData.push(plane);
  }

  doc.bulkLoad(allData, tempLayers);
}

function findNodeByNumber(nodes: Node[], num: number): Node | null {
  return nodes.find(n => n.number === num) ?? null;
}

function createMember(typeName: string, elem: Element, nodes: Node[]): DocumentData {
  const numberStr = readChild(elem, 'Number', '0');
  const nodeINum = parseInt(readChild(elem, 'NodeI', '0'));
  const nodeJNum = parseInt(readChild(elem, 'NodeJ', '0'));
  const section = readChild(elem, 'Section', '');

  const n1 = findNodeByNumber(nodes, nodeINum);
  const n2 = findNodeByNumber(nodes, nodeJNum);

  if (!n1 || !n2) {
    throw new Error(`Member node not found: NodeI=${nodeINum}, NodeJ=${nodeJNum}`);
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
    member.section = section || 'G1';
  } else {
    member = new Pillar(nodeI, nodeJ);
    member.section = section || 'C1';
  }

  member.number = parseInt(numberStr);
  member.select = readChild(elem, 'Select', 'False') === 'True';
  member.isNodeReverse = isReverse;
  return member;
}

function createPlane(typeName: string, elem: Element, nodes: Node[]): DocumentData | null {
  const nodeCount = parseInt(readChild(elem, 'NodeCount', '0'));
  const planeNodes: Node[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const nodeNum = parseInt(readChild(elem, `Node${i}`, '0'));
    const n = findNodeByNumber(nodes, nodeNum);
    if (!n) {
      console.warn(`Plane node not found: Node${i}=${nodeNum}`);
      return null;
    }
    planeNodes.push(n);
  }

  if (typeName === 'Floor') {
    const plane = new Floor(planeNodes);
    plane.weight = parseFloat(readChild(elem, 'Weight', '0'));
    const dirStr = readChild(elem, 'Direction', 'X');
    plane.direction = (FloorDirection as any)[dirStr] ?? FloorDirection.X;
    plane.number = parseInt(readChild(elem, 'Number', '0'));
    plane.select = readChild(elem, 'Select', 'False') === 'True';
    plane.section = readChild(elem, 'Section', '') || plane.section;
    return plane;
  }

  let plane: Wall | BearWall;
  if (typeName === 'Wall') {
    const wall = new Wall(planeNodes);
    wall.weight = parseFloat(readChild(elem, 'Weight', '0'));
    plane = wall;
  } else {
    plane = new BearWall(planeNodes);
  }

  plane.number = parseInt(readChild(elem, 'Number', '0'));
  plane.select = readChild(elem, 'Select', 'False') === 'True';
  plane.section = readChild(elem, 'Section', '') || plane.section;
  return plane;
}
