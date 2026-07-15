import { DocumentData } from './DocumentData';
import type { Node } from './Node';
import type { StructuralDof } from './StructuralDof';

/** Nodeの6自由度境界条件。固定自由度を名前で保持して剛体モード情報を失わない。 */
export class Support extends DocumentData {
  readonly kind = 'support' as const;
  node: Node | null = null;
  fixedDofs: StructuralDof[] = [];

  constructor(node?: Node, fixedDofs: ReadonlyArray<StructuralDof> = []) {
    super();
    if (node) this.node = node;
    this.fixedDofs = [...fixedDofs];
  }

  get typeText(): string {
    return '支点';
  }

  protected zRange(): { bottom: number; top: number } | null {
    return this.node ? { bottom: this.node.pos.z, top: this.node.pos.z } : null;
  }

  isReferring(node: Node): boolean {
    return this.node === node;
  }
}
