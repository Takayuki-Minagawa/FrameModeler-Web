import { Point2D } from './Point2D';

export class Point3D {
  public x: number;
  public y: number;
  public z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  clone(): Point3D {
    return new Point3D(this.x, this.y, this.z);
  }

  /** インデクサ: 0=x, 1=y, 2=z */
  get(i: number): number {
    switch (i) {
      case 0: return this.x;
      case 1: return this.y;
      case 2: return this.z;
      default: throw new RangeError('Index out of range');
    }
  }

  set(i: number, value: number): void {
    switch (i) {
      case 0: this.x = value; break;
      case 1: this.y = value; break;
      case 2: this.z = value; break;
      default: throw new RangeError('Index out of range');
    }
  }

  add(b: Point3D): Point3D {
    return new Point3D(this.x + b.x, this.y + b.y, this.z + b.z);
  }

  sub(b: Point3D): Point3D {
    return new Point3D(this.x - b.x, this.y - b.y, this.z - b.z);
  }

  negate(): Point3D {
    return new Point3D(-this.x, -this.y, -this.z);
  }

  scale(f: number): Point3D {
    return new Point3D(this.x * f, this.y * f, this.z * f);
  }

  div(f: number): Point3D {
    return new Point3D(this.x / f, this.y / f, this.z / f);
  }

  get length(): number {
    return Math.sqrt(this.lengthSquared);
  }

  get lengthSquared(): number {
    return Point3D.dotProduct(this, this);
  }

  get lengthXY(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  get lengthYZ(): number {
    return Math.sqrt(this.y * this.y + this.z * this.z);
  }

  get lengthZX(): number {
    return Math.sqrt(this.z * this.z + this.x * this.x);
  }

  normalize(): void {
    const len = this.length;
    if (len > 0) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
  }

  getNormalized(): Point3D {
    const copy = this.clone();
    copy.normalize();
    return copy;
  }

  equals(b: Point3D): boolean {
    return this.x === b.x && this.y === b.y && this.z === b.z;
  }

  /** XY平面へ投影 */
  toPointXY(): Point2D {
    return new Point2D(this.x, this.y);
  }

  toPointYZ(): Point2D {
    return new Point2D(this.y, this.z);
  }

  toPointZX(): Point2D {
    return new Point2D(this.z, this.x);
  }

  static dotProduct(a: Point3D, b: Point3D): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static crossProduct(a: Point3D, b: Point3D): Point3D {
    return new Point3D(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }

  static min(a: Point3D, b: Point3D): Point3D {
    return new Point3D(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
  }

  static max(a: Point3D, b: Point3D): Point3D {
    return new Point3D(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  }

  toString(): string {
    return `${this.x} ${this.y} ${this.z}`;
  }

  static parse(s: string): Point3D {
    const parts = s.trim().split(/\s+/);
    if (parts.length < 3) throw new Error('Invalid Point3D string: ' + s);
    return new Point3D(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
  }

  static readonly Zero = new Point3D(0, 0, 0);
  static readonly XDirection = new Point3D(1, 0, 0);
  static readonly YDirection = new Point3D(0, 1, 0);
  static readonly ZDirection = new Point3D(0, 0, 1);
  static readonly MaxValue = new Point3D(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
}
