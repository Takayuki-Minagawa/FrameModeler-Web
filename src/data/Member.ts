import { DocumentData } from './DocumentData';
import { Node } from './Node';
import { Point3D } from '../math/Point3D';

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
    return index === 0 ? this.nodeI : this.nodeJ;
  }

  setNode(index: number, n: Node): void {
    if (index === 0) this.nodeI = n;
    else this.nodeJ = n;
  }

  protected zRange(): { bottom: number; top: number } | null {
    if (!this.ok) return null;
    return {
      bottom: Math.min(this.nodeI!.pos.z, this.nodeJ!.pos.z),
      top: Math.max(this.nodeI!.pos.z, this.nodeJ!.pos.z),
    };
  }

  /** 指定Nodeを参照しているか */
  isReferring(n: Node): boolean {
    return n === this.nodeI || n === this.nodeJ;
  }
}
