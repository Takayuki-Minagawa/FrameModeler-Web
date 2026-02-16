import { Plane } from './Plane';
import { Node } from './Node';

export class Wall extends Plane {
  weight: number = 0;

  constructor(nodes?: Node[]) {
    super(nodes);
  }

  get typeText(): string {
    return '壁';
  }

  get wallLength(): number {
    if (this.nodeCount === 0) return 0;
    const dx = this.nodeList[0].pos.x - this.nodeList[1].pos.x;
    const dy = this.nodeList[0].pos.y - this.nodeList[1].pos.y;
    const dz = this.nodeList[0].pos.z - this.nodeList[1].pos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  save(writer: (name: string, value: string) => void): void {
    super.save(writer);
    writer('Weight', String(this.weight));
  }

  load(reader: (name: string, defaultValue?: string) => string): void {
    super.load(reader);
    this.weight = parseFloat(reader('Weight', '0'));
  }
}
