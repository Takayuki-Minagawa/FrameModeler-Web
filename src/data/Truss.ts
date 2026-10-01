import { Member, type MemberState } from './Member';
import type { Node } from './Node';
import type { DataState } from './DataState';

interface TrussState extends MemberState {
  material: string;
  area: number;
  areaUnit: string;
  elasticModulus: number | null;
  stressUnit: string;
}

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

  override captureState(): TrussState {
    return {
      ...super.captureState(),
      material: this.material,
      area: this.area,
      areaUnit: this.areaUnit,
      elasticModulus: this.elasticModulus,
      stressUnit: this.stressUnit,
    };
  }

  override restoreState(state: DataState): void {
    super.restoreState(state);
    const truss = state as TrussState;
    this.material = truss.material;
    this.area = truss.area;
    this.areaUnit = truss.areaUnit;
    this.elasticModulus = truss.elasticModulus;
    this.stressUnit = truss.stressUnit;
  }
}
