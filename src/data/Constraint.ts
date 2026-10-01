import { DocumentData } from './DocumentData';
import type { Node } from './Node';
import type { StructuralDof } from './StructuralDof';
import type { DataState } from './DataState';

export interface ConstraintTerm {
  node: Node;
  dof: StructuralDof;
  coefficient: number;
}

interface ConstraintState extends DataState {
  constraintKind: Constraint['constraintKind'];
  slaveNode: Node | null;
  slaveDof: StructuralDof;
  terms: ConstraintTerm[];
}

/** slave DOFを複数master項へ結ぶ線形/equalDOF拘束。 */
export class Constraint extends DocumentData {
  readonly kind = 'constraint' as const;
  constraintKind = 'equalDOF' as const;
  slaveNode: Node | null = null;
  slaveDof: StructuralDof = 'ux';
  terms: ConstraintTerm[] = [];

  constructor(slaveNode?: Node, slaveDof: StructuralDof = 'ux', terms: ReadonlyArray<ConstraintTerm> = []) {
    super();
    if (slaveNode) this.slaveNode = slaveNode;
    this.slaveDof = slaveDof;
    this.terms = terms.map((term) => ({ ...term }));
  }

  get typeText(): string {
    return '多点拘束';
  }

  protected zRange(): { bottom: number; top: number } | null {
    const nodes = this.referencedNodes;
    if (nodes.length === 0) return null;
    const elevations = nodes.map((node) => node.pos.z);
    return { bottom: Math.min(...elevations), top: Math.max(...elevations) };
  }

  captureState(): ConstraintState {
    return {
      constraintKind: this.constraintKind,
      slaveNode: this.slaveNode,
      slaveDof: this.slaveDof,
      terms: this.terms.map((term) => ({ ...term })),
    };
  }

  restoreState(state: DataState): void {
    const constraint = state as ConstraintState;
    this.constraintKind = constraint.constraintKind;
    this.slaveNode = constraint.slaveNode;
    this.slaveDof = constraint.slaveDof;
    this.terms = constraint.terms.map((term) => ({ ...term }));
  }

  /** slave、master項の順。同じNodeが複数回現れる場合がある。 */
  override get referencedNodes(): ReadonlyArray<Node> {
    return [this.slaveNode, ...this.terms.map((term) => term.node)].filter((node): node is Node => node !== null);
  }

  override remapNodes(map: ReadonlyMap<Node, Node>): void {
    if (this.slaveNode) this.slaveNode = map.get(this.slaveNode) ?? this.slaveNode;
    this.terms = this.terms.map((term) => ({ ...term, node: map.get(term.node) ?? term.node }));
  }
}
