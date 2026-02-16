import { Member } from './Member';
import { Node } from './Node';

export class Beam extends Member {
  constructor(nodeI?: Node, nodeJ?: Node) {
    super(nodeI, nodeJ);
    this.section = 'G1';
  }

  get typeText(): string {
    return '梁';
  }

  compareTo(other: Beam): number {
    const x1 = Math.max(this.nodeI!.pos.x, this.nodeJ!.pos.x);
    const y1 = Math.max(this.nodeI!.pos.y, this.nodeJ!.pos.y);
    const z1 = Math.max(this.nodeI!.pos.z, this.nodeJ!.pos.z);
    const dir1 = this.nodeI!.pos.sub(this.nodeJ!.pos).lengthYZ < 0.1;

    const x2 = Math.max(other.nodeI!.pos.x, other.nodeJ!.pos.x);
    const y2 = Math.max(other.nodeI!.pos.y, other.nodeJ!.pos.y);
    const z2 = Math.max(other.nodeI!.pos.z, other.nodeJ!.pos.z);
    const dir2 = other.nodeI!.pos.sub(other.nodeJ!.pos).lengthYZ < 0.1;

    if (z1 < z2) return -1;
    if (z1 > z2) return +1;
    if (dir1 && !dir2) return -1;
    if (!dir1 && dir2) return +1;
    if (y1 < y2) return -1;
    if (y1 > y2) return +1;
    if (x1 < x2) return -1;
    if (x1 > x2) return +1;
    return 0;
  }
}
