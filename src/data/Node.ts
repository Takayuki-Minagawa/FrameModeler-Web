import { DocumentData } from './DocumentData';
import { Point3D } from '../math/Point3D';
import { compareNumbers } from '../math/compare';

export class Node extends DocumentData {
  pos: Point3D = new Point3D();

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
