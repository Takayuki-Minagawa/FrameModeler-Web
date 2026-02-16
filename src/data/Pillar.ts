import { Member } from './Member';
import { Node } from './Node';

export class Pillar extends Member {
  constructor(nodeI?: Node, nodeJ?: Node) {
    super(nodeI, nodeJ);
    this.section = 'C1';
  }

  get typeText(): string {
    return '柱';
  }

  compareTo(other: Pillar): number {
    const z1 = Math.min(this.nodeI!.pos.z, this.nodeJ!.pos.z);
    const z2 = Math.min(other.nodeI!.pos.z, other.nodeJ!.pos.z);

    if (z1 < z2) return -1;
    if (z1 > z2) return +1;
    if (this.nodeI!.pos.y < other.nodeI!.pos.y) return -1;
    if (this.nodeI!.pos.y > other.nodeI!.pos.y) return +1;
    if (this.nodeI!.pos.x < other.nodeI!.pos.x) return -1;
    if (this.nodeI!.pos.x > other.nodeI!.pos.x) return +1;
    return 0;
  }
}
