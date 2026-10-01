import { cloneWithNodes } from './DataClone';
import { stateValuesEqual } from './DataState';
import type { Document } from './Document';
import type { DocumentData } from './DocumentData';
import { Node } from './Node';
import { Point3D } from '../math/Point3D';

/** 複製先に既存Nodeがあるとみなす座標許容差（mm）。 */
export const COPY_NODE_TOLERANCE = 1e-6;

export interface ElementCopyRequest {
  /** 複製するNode。elements が参照するNodeはここに無くても自動的に含める。 */
  nodes: ReadonlyArray<Node>;
  /** 複製するNode以外の要素。 */
  elements: ReadonlyArray<DocumentData>;
  /** 複製1回ごとの座標変換。複製元の座標から複製先の座標を返す。 */
  transforms: ReadonlyArray<(position: Point3D) => Point3D>;
}

/** 平行移動を count 回繰り返す変換（1回目 = offset、2回目 = offset×2 …）を作る。 */
export function repeatedOffsetTransforms(offset: Point3D, count: number): Array<(position: Point3D) => Point3D> {
  return Array.from({ length: count }, (_, index) => {
    const step = offset.scale(index + 1);
    return (position: Point3D) => position.add(step);
  });
}

/**
 * 指定要素を座標変換して複製するための追加要素を計画する。Documentは変更しない。
 *
 * - 複製先座標に既存Node（または先行する複製で作ったNode）があれば再利用する。
 * - 同一座標の別Node（零長ばねなど）は1対1で対応させ、1つのNodeへ潰さない。
 * - 同じ種別・同じ参照Node・同じ属性の要素が既にあれば追加しない。
 */
export function planElementCopies(document: Document, request: ElementCopyRequest): DocumentData[] {
  const elements = uniqueInOrder(request.elements.filter((element) => !(element instanceof Node)));
  const sourceNodes = uniqueInOrder([...request.nodes, ...elements.flatMap((element) => [...element.referencedNodes])]);
  if (sourceNodes.length === 0) return [];

  const nodeIndex = new NodePositionIndex(document.nodeList);
  const elementIndex = new ElementEquivalenceIndex(document.allDataList);
  const additions: DocumentData[] = [];

  for (const transform of request.transforms) {
    const nodeMap = new Map<Node, Node>();
    const claimed = new Set<Node>();

    for (const sourceNode of sourceNodes) {
      const target = transform(sourceNode.pos);
      const existing = nodeIndex.findUnclaimed(target, claimed);
      if (existing) {
        nodeMap.set(sourceNode, existing);
        claimed.add(existing);
        continue;
      }
      const copy = cloneWithNodes(sourceNode, nodeMap);
      copy.pos = target;
      claimed.add(copy);
      nodeIndex.add(copy);
      additions.push(copy);
    }

    for (const element of elements) {
      const copy = cloneWithNodes(element, nodeMap);
      if (elementIndex.hasEquivalent(copy)) continue;
      elementIndex.add(copy);
      additions.push(copy);
    }
  }
  return additions;
}

function uniqueInOrder<T>(items: ReadonlyArray<T>): T[] {
  return [...new Set(items)];
}

/** 座標を許容差の格子へ丸めたキーでNodeを引く。隣接セルも調べ、境界付近の取りこぼしを防ぐ。 */
class NodePositionIndex {
  private readonly cells = new Map<string, Node[]>();

  constructor(nodes: Iterable<Node>) {
    for (const node of nodes) this.add(node);
  }

  add(node: Node): void {
    const key = cellKey(cellOf(node.pos.x), cellOf(node.pos.y), cellOf(node.pos.z));
    const cell = this.cells.get(key);
    if (cell) cell.push(node);
    else this.cells.set(key, [node]);
  }

  findUnclaimed(position: Point3D, claimed: ReadonlySet<Node>): Node | null {
    const cx = cellOf(position.x);
    const cy = cellOf(position.y);
    const cz = cellOf(position.z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = this.cells.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!cell) continue;
          const match = cell.find((node) => !claimed.has(node) && node.pos.sub(position).length <= COPY_NODE_TOLERANCE);
          if (match) return match;
        }
      }
    }
    return null;
  }
}

function cellOf(value: number): number {
  return Math.floor(value / (COPY_NODE_TOLERANCE * 2));
}

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** 種別と参照Nodeの組で候補を絞り、型ごとの state で等価な既存要素を検出する。 */
class ElementEquivalenceIndex {
  private readonly buckets = new Map<string, DocumentData[]>();
  private readonly nodeIds = new WeakMap<Node, number>();
  private nextNodeId = 0;

  constructor(dataList: Iterable<DocumentData>) {
    for (const data of dataList) {
      if (!(data instanceof Node)) this.add(data);
    }
  }

  add(data: DocumentData): void {
    const key = this.keyOf(data);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(data);
    else this.buckets.set(key, [data]);
  }

  hasEquivalent(candidate: DocumentData): boolean {
    const bucket = this.buckets.get(this.keyOf(candidate));
    if (!bucket) return false;
    const state = candidate.captureState();
    return bucket.some((data) => stateValuesEqual(data.captureState(), state));
  }

  private keyOf(data: DocumentData): string {
    return `${data.kind}:${data.referencedNodes.map((node) => this.idOf(node)).join(',')}`;
  }

  private idOf(node: Node): number {
    let id = this.nodeIds.get(node);
    if (id === undefined) {
      id = this.nextNodeId++;
      this.nodeIds.set(node, id);
    }
    return id;
  }
}
