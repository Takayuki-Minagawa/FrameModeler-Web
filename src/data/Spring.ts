import { Member, type MemberState } from './Member';
import type { Node } from './Node';
import { Point3D } from '../math/Point3D';
import type { StructuralDof } from './StructuralDof';
import type { DataState } from './DataState';

export interface SpringComponent {
  dof: StructuralDof;
  stiffness: number;
  unit: string;
}

interface SpringState extends MemberState {
  components: SpringComponent[];
  orientX: Point3D | null;
  orientY: Point3D | null;
  shearDistance: [number, number] | null;
  note: string;
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

  override captureState(): SpringState {
    return {
      ...super.captureState(),
      components: this.components.map((component) => ({ ...component })),
      orientX: this.orientX?.clone() ?? null,
      orientY: this.orientY?.clone() ?? null,
      shearDistance: this.shearDistance ? [...this.shearDistance] : null,
      note: this.note,
    };
  }

  override restoreState(state: DataState): void {
    super.restoreState(state);
    const spring = state as SpringState;
    this.components = spring.components.map((component) => ({ ...component }));
    this.orientX = spring.orientX?.clone() ?? null;
    this.orientY = spring.orientY?.clone() ?? null;
    this.shearDistance = spring.shearDistance ? [...spring.shearDistance] : null;
    this.note = spring.note;
  }
}
