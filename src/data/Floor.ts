import { Plane } from './Plane';
import { Node } from './Node';

export enum FloorDirection {
  X = 'X',
  Y = 'Y',
  XY = 'XY',
  DUMMY = 'DUMMY',
}

export class Floor extends Plane {
  weight: number = 0;
  direction: FloorDirection = FloorDirection.X;

  constructor(nodes?: Node[]) {
    super(nodes);
    this.section = 'S1';
  }

  get typeText(): string {
    return '床';
  }

  get lengthAlongDirection(): number {
    if (this.nodeCount === 0) return 0;
    const di = this.direction === FloorDirection.X ? 0 : 1;
    let min = Number.MAX_VALUE;
    let max = -Number.MAX_VALUE;
    for (const n of this.nodeList) {
      const v = n.pos.get(di);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return max - min;
  }

  compareTo(other: Floor): number {
    const p1 = this.nodeList[0].pos.add(this.nodeList[2].pos).div(2);
    const p2 = other.nodeList[0].pos.add(other.nodeList[2].pos).div(2);
    if (Math.abs(p1.z - p2.z) > 0.01) {
      if (p1.z < p2.z) return -1;
      if (p1.z > p2.z) return +1;
    }
    if (p1.length < p2.length) return -1;
    if (p1.length > p2.length) return +1;
    return 0;
  }

  save(writer: (name: string, value: string) => void): void {
    super.save(writer);
    writer('Weight', String(this.weight));
    writer('Direction', this.direction);
  }

  load(reader: (name: string, defaultValue?: string) => string): void {
    super.load(reader);
    this.weight = parseFloat(reader('Weight', '0'));
    const dirStr = reader('Direction', 'X');
    this.direction = (FloorDirection as any)[dirStr] ?? FloorDirection.X;
  }
}
