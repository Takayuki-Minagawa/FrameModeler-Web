import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { Point3D } from '../../math/Point3D';

export interface PlannedNodes {
  nodes: Node[];
  additions: Node[];
}

/**
 * 既存Nodeを再利用し、存在しない座標だけ未追加Nodeとして計画する。
 * additionsと参照要素をDocument.addManyへ一緒に渡すことで孤立Nodeを防ぐ。
 */
export function planNodes(points: ReadonlyArray<Point3D>): PlannedNodes {
  const doc = Document.instance;
  const additions: Node[] = [];
  const nodes = points.map((point) => {
    const existing = doc.getNodeAt(point);
    if (existing) return existing;
    const planned = additions.find((node) => node.pos.sub(point).length <= 0.5);
    if (planned) return planned;
    const node = new Node(point);
    additions.push(node);
    return node;
  });
  return { nodes, additions };
}

/** 2点を対角とする矩形の4頂点を返す（床用）。Zは2点の中点高さ。 */
export function createRectPoints(p: Point3D, q: Point3D): Point3D[] {
  const min = Point3D.min(p, q);
  const max = Point3D.max(p, q);
  const z = (min.z + max.z) / 2;
  return [
    new Point3D(min.x, min.y, z),
    new Point3D(max.x, min.y, z),
    new Point3D(max.x, max.y, z),
    new Point3D(min.x, max.y, z),
  ];
}

/** 下端2点とその直上点からなる四角形の4頂点を返す（壁/耐力壁用）。 */
export function createQuadPoints(p: Point3D, q: Point3D): { points: Point3D[]; aboveExists: boolean } {
  const doc = Document.instance;
  const aboveP = doc.getPosAbove(p);
  const aboveQ = doc.getPosAbove(q);

  const aboveExists = aboveP !== null && aboveQ !== null;
  return {
    points: [p, q, aboveQ ?? q, aboveP ?? p],
    aboveExists,
  };
}
