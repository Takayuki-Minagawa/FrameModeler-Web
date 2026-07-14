import { Plane } from './Plane';
import { Node } from './Node';

export class Wall extends Plane {
  readonly kind = 'wall' as const;
  weight: number = 0;

  constructor(nodes?: Node[]) {
    super(nodes);
  }

  get typeText(): string {
    return '壁';
  }

  get wallLength(): number {
    if (this.nodeCount < 2) return 0;
    return this.nodeList[0].pos.sub(this.nodeList[1].pos).length;
  }
}
