import { DocumentData } from './DocumentData';
import type { Node } from './Node';
import type { StructuralDof } from './StructuralDof';

export interface ConstraintTerm {
  node: Node;
  dof: StructuralDof;
  coefficient: number;
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
    const nodes = [this.slaveNode, ...this.terms.map((term) => term.node)].filter(
      (node): node is Node => node !== null,
    );
    if (nodes.length === 0) return null;
    const elevations = nodes.map((node) => node.pos.z);
    return { bottom: Math.min(...elevations), top: Math.max(...elevations) };
  }

  isReferring(node: Node): boolean {
    return this.slaveNode === node || this.terms.some((term) => term.node === node);
  }
}
