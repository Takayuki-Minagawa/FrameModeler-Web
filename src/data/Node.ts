import { DocumentData } from './DocumentData';
import { Point3D } from '../math/Point3D';
import { compareNumbers } from '../math/compare';
import type { NodeMass } from './StructuralDof';

export class Node extends DocumentData {
  readonly kind = 'node' as const;
  pos: Point3D = new Point3D();
  /** YAML/JSON由来の6自由度質量。未設定Nodeはnull。 */
  mass: NodeMass | null = null;

  constructor(pos?: Point3D) {
    super();
    if (pos) this.pos = pos.clone();
  }

  get typeText(): string {
    return 'ノード';
  }

  /** 点なのでZ範囲は単一高さ */
  protected zRange(): { bottom: number; top: number } {
    return { bottom: this.pos.z, top: this.pos.z };
  }

  compareTo(other: Node): number {
    return compareNumbers([this.pos.z, other.pos.z], [this.pos.y, other.pos.y], [this.pos.x, other.pos.x]);
  }
}
