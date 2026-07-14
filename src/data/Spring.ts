import { Member } from './Member';
import type { Node } from './Node';
import { Point3D } from '../math/Point3D';
import type { StructuralDof } from './StructuralDof';

export interface SpringComponent {
  dof: StructuralDof;
  stiffness: number;
  unit: string;
}

/** 2節点間ばね。別Nodeであれば同一座標（零長）を明示的に許可する。 */
export class Spring extends Member {
  readonly kind = 'spring' as const;
  components: SpringComponent[] = [];
  orientX: Point3D | null = null;
  orientY: Point3D | null = null;
  shearDistance: [number, number] | null = null;
  note = '';

  constructor(nodeI?: Node, nodeJ?: Node) {
    super(nodeI, nodeJ);
    this.section = 'SPRING';
  }

  get typeText(): string {
    return 'ばね';
  }
}
