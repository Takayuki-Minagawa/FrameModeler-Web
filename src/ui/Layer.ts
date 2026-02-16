export class Layer {
  posZ: number;
  name: string;

  constructor(z: number = 0, name: string = '新規レイヤー') {
    this.posZ = z;
    this.name = name;
  }

  clone(): Layer {
    return new Layer(this.posZ, this.name);
  }

  equals(other: Layer): boolean {
    return this.posZ === other.posZ;
  }

  compareTo(other: Layer): number {
    if (this.posZ < other.posZ) return -1;
    if (this.posZ > other.posZ) return +1;
    return 0;
  }

  toString(): string {
    return `${this.name} : ${this.posZ}`;
  }
}
