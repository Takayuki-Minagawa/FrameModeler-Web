import { Plane } from './Plane';
import { Node } from './Node';

export class BearWall extends Plane {
  constructor(nodes?: Node[]) {
    super(nodes);
    this.section = 'V1';
  }

  get typeText(): string {
    return '耐力壁';
  }
}
