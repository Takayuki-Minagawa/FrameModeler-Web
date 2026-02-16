export class Point2D {
  public x: number;
  public y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  clone(): Point2D {
    return new Point2D(this.x, this.y);
  }

  add(b: Point2D): Point2D {
    return new Point2D(this.x + b.x, this.y + b.y);
  }

  sub(b: Point2D): Point2D {
    return new Point2D(this.x - b.x, this.y - b.y);
  }

  negate(): Point2D {
    return new Point2D(-this.x, -this.y);
  }

  scale(f: number): Point2D {
    return new Point2D(this.x * f, this.y * f);
  }

  div(f: number): Point2D {
    return new Point2D(this.x / f, this.y / f);
  }

  get length(): number {
    return Math.sqrt(this.lengthSquared);
  }

  get lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): void {
    const len = this.length;
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
  }

  getNormalized(): Point2D {
    const copy = this.clone();
    copy.normalize();
    return copy;
  }

  equals(b: Point2D): boolean {
    return this.x === b.x && this.y === b.y;
  }

  static dotProduct(a: Point2D, b: Point2D): number {
    return a.x * b.x + a.y * b.y;
  }

  static crossProduct(a: Point2D, b: Point2D): number {
    return a.x * b.y - a.y * b.x;
  }

  toString(): string {
    return `${this.x} ${this.y}`;
  }

  static parse(s: string): Point2D {
    const parts = s.trim().split(/\s+/);
    if (parts.length < 2) throw new Error('Invalid Point2D string: ' + s);
    return new Point2D(parseFloat(parts[0]), parseFloat(parts[1]));
  }

  static readonly Zero = new Point2D(0, 0);
  static readonly XDirection = new Point2D(1, 0);
  static readonly YDirection = new Point2D(0, 1);
}
