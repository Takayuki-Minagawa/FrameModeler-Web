import { DocumentData } from './DocumentData';
import { Node } from './Node';
import { Point3D } from '../math/Point3D';

/**
 * 面要素の抽象基底クラス（複数節点で構成）
 * Floor, Wall, BearWall が継承する
 */
export abstract class Plane extends DocumentData {
  protected nodes: Node[] = [];
  section: string = '';

  constructor(nodes?: Node[]) {
    super();
    if (nodes) this.nodes = [...nodes];
  }

  get nodeList(): ReadonlyArray<Node> {
    return this.nodes;
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  getNode(index: number): Node {
    return this.nodes[index];
  }

  setNode(index: number, n: Node): void {
    this.nodes[index] = n;
  }

  addNode(n: Node): void {
    this.nodes.push(n);
  }

  get ok(): boolean {
    return this.nodes.length > 0;
  }

  get center(): Point3D {
    return Point3D.average(this.nodes.map(n => n.pos));
  }

  get range(): Point3D {
    if (this.nodes.length === 0) return Point3D.Zero.clone();
    let min = Point3D.MaxValue.clone();
    let max = Point3D.MaxValue.negate();
    for (const n of this.nodes) {
      min = Point3D.min(min, n.pos);
      max = Point3D.max(max, n.pos);
    }
    return max.sub(min);
  }

  protected zRange(): { bottom: number; top: number } | null {
    if (!this.ok) return null;
    let bottom = Number.MAX_VALUE;
    let top = -Number.MAX_VALUE;
    for (const n of this.nodes) {
      bottom = Math.min(bottom, n.pos.z);
      top = Math.max(top, n.pos.z);
    }
    return { bottom, top };
  }

  isReferring(n: Node): boolean {
    return this.nodes.includes(n);
  }
}
