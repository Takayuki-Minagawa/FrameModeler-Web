import { Member } from './Member';
import { Node } from './Node';
import { compareNumbers } from '../math/compare';

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
    return compareNumbers(
      [z1, z2],
      [this.nodeI!.pos.y, other.nodeI!.pos.y],
      [this.nodeI!.pos.x, other.nodeI!.pos.x],
    );
  }
}
