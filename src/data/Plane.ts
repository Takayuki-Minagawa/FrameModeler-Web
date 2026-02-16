import { DocumentData } from './DocumentData';
import { Node } from './Node';
import { Point3D } from '../math/Point3D';
import type { Layer } from '../ui/Layer';

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
    return this.nodes.every(n => n !== null);
  }

  get center(): Point3D {
    if (this.nodes.length === 0) return Point3D.Zero.clone();
    let sum = new Point3D();
    for (const n of this.nodes) {
      sum = sum.add(n.pos);
    }
    return sum.div(this.nodes.length);
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

  existsOn(layer: Layer | null): boolean {
    if (!layer || !this.ok) return false;
    let bottom = Number.MAX_VALUE;
    let top = -Number.MAX_VALUE;
    for (const n of this.nodes) {
      bottom = Math.min(bottom, n.pos.z);
      top = Math.max(top, n.pos.z);
    }
    return bottom <= layer.posZ && layer.posZ <= top;
  }

  isReferring(n: Node): boolean {
    return this.nodes.includes(n);
  }

  save(writer: (name: string, value: string) => void): void {
    super.save(writer);
    writer('NodeCount', String(this.nodeCount));
    for (let i = 0; i < this.nodes.length; i++) {
      writer(`Node${i}`, String(this.nodes[i].number));
    }
    if (this.section) writer('Section', this.section);
  }
}
