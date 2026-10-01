import { Plane, type PlaneState } from './Plane';
import { Node } from './Node';
import type { DataState } from './DataState';

interface WallState extends PlaneState {
  weight: number;
}

export class Wall extends Plane {
  readonly kind = 'wall' as const;
  weight: number = 0;

  constructor(nodes?: Node[]) {
    super(nodes);
  }

  get typeText(): string {
    return '壁';
  }

  override captureState(): WallState {
    return { ...super.captureState(), weight: this.weight };
  }

  override restoreState(state: DataState): void {
    super.restoreState(state);
    this.weight = (state as WallState).weight;
  }

  get wallLength(): number {
    if (this.nodeCount < 2) return 0;
    return this.nodeList[0].pos.sub(this.nodeList[1].pos).length;
  }
}
