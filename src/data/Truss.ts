import { Member } from './Member';
import type { Node } from './Node';

/** 軸力だけを伝達する3Dトラス要素。 */
export class Truss extends Member {
  readonly kind = 'truss' as const;
  material = '';
  area = 0;
  areaUnit = 'mm^2';
  elasticModulus: number | null = null;
  stressUnit = 'N/mm^2';

  constructor(nodeI?: Node, nodeJ?: Node) {
    super(nodeI, nodeJ);
    this.section = 'TRUSS';
  }

  get typeText(): string {
    return 'トラス';
  }
}
