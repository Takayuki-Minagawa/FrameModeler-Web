import { DocumentData } from './DocumentData';
import { Node } from './Node';
import { Point3D } from '../math/Point3D';
import type { DataState } from './DataState';

export interface MemberState extends DataState {
  nodeI: Node | null;
  nodeJ: Node | null;
  section: string;
  isNodeReverse: boolean;
}

/**
 * 部材の抽象基底クラス（2節点間の線要素）
 * Beam, Pillar が継承する
 */
export abstract class Member extends DocumentData {
  nodeI: Node | null = null;
  nodeJ: Node | null = null;
  section: string = '';
  isNodeReverse: boolean = false;

  constructor(nodeI?: Node, nodeJ?: Node) {
    super();
    if (nodeI) this.nodeI = nodeI;
    if (nodeJ) this.nodeJ = nodeJ;
  }

  get posI(): Point3D {
    return this.nodeI!.pos;
  }

  get posJ(): Point3D {
    return this.nodeJ!.pos;
  }

  get ok(): boolean {
    return this.nodeI !== null && this.nodeJ !== null;
  }

  getNode(index: number): Node | null {
    if (index === 0) return this.nodeI;
    if (index === 1) return this.nodeJ;
    throw new RangeError(`Member node index must be 0 or 1, got ${index}`);
  }

  setNode(index: number, n: Node): void {
    if (index === 0) {
      this.nodeI = n;
      return;
    }
    if (index === 1) {
      this.nodeJ = n;
      return;
    }
    throw new RangeError(`Member node index must be 0 or 1, got ${index}`);
  }

  protected zRange(): { bottom: number; top: number } | null {
    if (!this.ok) return null;
    return {
      bottom: Math.min(this.nodeI!.pos.z, this.nodeJ!.pos.z),
      top: Math.max(this.nodeI!.pos.z, this.nodeJ!.pos.z),
    };
  }

  captureState(): MemberState {
    return { nodeI: this.nodeI, nodeJ: this.nodeJ, section: this.section, isNodeReverse: this.isNodeReverse };
  }

  restoreState(state: DataState): void {
    const member = state as MemberState;
    this.nodeI = member.nodeI;
    this.nodeJ = member.nodeJ;
    this.section = member.section;
    this.isNodeReverse = member.isNodeReverse;
  }

  override get referencedNodes(): ReadonlyArray<Node> {
    return [this.nodeI, this.nodeJ].filter((node): node is Node => node !== null);
  }

  override remapNodes(map: ReadonlyMap<Node, Node>): void {
    if (this.nodeI) this.nodeI = map.get(this.nodeI) ?? this.nodeI;
    if (this.nodeJ) this.nodeJ = map.get(this.nodeJ) ?? this.nodeJ;
  }
}
