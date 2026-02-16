import { DocumentData } from './DocumentData';
import { Point3D } from '../math/Point3D';
import type { Layer } from '../ui/Layer';

export class Node extends DocumentData {
  pos: Point3D = new Point3D();

  constructor(pos?: Point3D) {
    super();
    if (pos) this.pos = pos.clone();
  }

  get typeText(): string {
    return 'ノード';
  }

  /** 指定レイヤー上に存在するか */
  existsOn(layer: Layer | null): boolean {
    if (!layer) return false;
    return this.pos.z === layer.posZ;
  }

  compareTo(other: Node): number {
    if (this.pos.z < other.pos.z) return -1;
    if (this.pos.z > other.pos.z) return +1;
    if (this.pos.y < other.pos.y) return -1;
    if (this.pos.y > other.pos.y) return +1;
    if (this.pos.x < other.pos.x) return -1;
    if (this.pos.x > other.pos.x) return +1;
    return 0;
  }

  save(writer: (name: string, value: string) => void): void {
    super.save(writer);
    writer('Pos', this.pos.toString());
    writer('Select', String(this.select));
  }

  load(reader: (name: string, defaultValue?: string) => string): void {
    super.load(reader);
    this.pos = Point3D.parse(reader('Pos', '0 0 0'));
    this.select = reader('Select', 'False') === 'True';
  }
}
