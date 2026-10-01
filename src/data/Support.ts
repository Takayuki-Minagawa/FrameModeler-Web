import { DocumentData } from './DocumentData';
import type { Node } from './Node';
import type { StructuralDof } from './StructuralDof';
import type { DataState } from './DataState';

interface SupportState extends DataState {
  node: Node | null;
  fixedDofs: StructuralDof[];
}

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

  captureState(): SupportState {
    return { node: this.node, fixedDofs: [...this.fixedDofs] };
  }

  restoreState(state: DataState): void {
    const support = state as SupportState;
    this.node = support.node;
    this.fixedDofs = [...support.fixedDofs];
  }

  override get referencedNodes(): ReadonlyArray<Node> {
    return this.node ? [this.node] : [];
  }

  override remapNodes(map: ReadonlyMap<Node, Node>): void {
    if (this.node) this.node = map.get(this.node) ?? this.node;
  }
}
