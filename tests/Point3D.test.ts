import { describe, it, expect } from 'vitest';
import { Point3D } from '../src/math/Point3D';
import { Point2D } from '../src/math/Point2D';

describe('Point3D', () => {
  it('constructs with defaults', () => {
    const p = new Point3D();
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.z).toBe(0);
  });

  it('constructs with values and clones', () => {
    const p = new Point3D(1, 2, 3);
    const c = p.clone();
    expect(c).not.toBe(p);
    expect(c.x).toBe(1);
    expect(c.y).toBe(2);
    expect(c.z).toBe(3);
  });

  it('get returns components and throws RangeError out of range', () => {
    const p = new Point3D(1, 2, 3);
    expect(p.get(0)).toBe(1);
    expect(p.get(1)).toBe(2);
    expect(p.get(2)).toBe(3);
    expect(() => p.get(3)).toThrow(RangeError);
    expect(() => p.get(-1)).toThrow(RangeError);
  });

  it('set mutates components and throws RangeError out of range', () => {
    const p = new Point3D(0, 0, 0);
    p.set(0, 10);
    p.set(1, 20);
    p.set(2, 30);
    expect(p.x).toBe(10);
    expect(p.y).toBe(20);
    expect(p.z).toBe(30);
    expect(() => p.set(3, 1)).toThrow(RangeError);
  });

  it('add / sub / negate / scale / div', () => {
    const a = new Point3D(1, 2, 3);
    const b = new Point3D(4, 5, 6);
    expect(a.add(b).equals(new Point3D(5, 7, 9))).toBe(true);
    expect(b.sub(a).equals(new Point3D(3, 3, 3))).toBe(true);
    expect(a.negate().equals(new Point3D(-1, -2, -3))).toBe(true);
    expect(a.scale(2).equals(new Point3D(2, 4, 6))).toBe(true);
    expect(b.div(2).equals(new Point3D(2, 2.5, 3))).toBe(true);
  });

  it('length / lengthSquared / lengthXY', () => {
    const p = new Point3D(3, 4, 12);
    expect(p.lengthSquared).toBe(169);
    expect(p.length).toBeCloseTo(13);
    expect(p.lengthXY).toBeCloseTo(5);
  });

  it('normalize and getNormalized', () => {
    const p = new Point3D(0, 3, 4);
    const n = p.getNormalized();
    expect(n.length).toBeCloseTo(1);
    expect(n.y).toBeCloseTo(0.6);
    expect(n.z).toBeCloseTo(0.8);
    // original untouched by getNormalized
    expect(p.y).toBe(3);

    const m = new Point3D(0, 3, 4);
    m.normalize();
    expect(m.length).toBeCloseTo(1);
  });

  it('normalize of zero vector is a no-op', () => {
    const p = new Point3D(0, 0, 0);
    p.normalize();
    expect(p.equals(new Point3D(0, 0, 0))).toBe(true);
  });

  it('equals compares exact values', () => {
    expect(new Point3D(1, 2, 3).equals(new Point3D(1, 2, 3))).toBe(true);
    expect(new Point3D(1, 2, 3).equals(new Point3D(1, 2, 3.0001))).toBe(false);
  });

  it('toPointXY projects onto XY plane', () => {
    const p = new Point3D(1, 2, 3).toPointXY();
    expect(p).toBeInstanceOf(Point2D);
    expect(p.x).toBe(1);
    expect(p.y).toBe(2);
  });

  it('static dotProduct', () => {
    expect(Point3D.dotProduct(new Point3D(1, 2, 3), new Point3D(4, 5, 6))).toBe(32);
  });

  it('static crossProduct', () => {
    const c = Point3D.crossProduct(Point3D.XDirection, Point3D.YDirection);
    expect(c.equals(new Point3D(0, 0, 1))).toBe(true);
  });

  it('static min / max', () => {
    const a = new Point3D(1, 5, 3);
    const b = new Point3D(4, 2, 6);
    expect(Point3D.min(a, b).equals(new Point3D(1, 2, 3))).toBe(true);
    expect(Point3D.max(a, b).equals(new Point3D(4, 5, 6))).toBe(true);
  });

  it('toString formats as "x y z"', () => {
    expect(new Point3D(1, 2, 3).toString()).toBe('1 2 3');
  });

  it('parse and toString round trip', () => {
    const p = new Point3D(1.5, -2.25, 3);
    const parsed = Point3D.parse(p.toString());
    expect(parsed.x).toBeCloseTo(1.5);
    expect(parsed.y).toBeCloseTo(-2.25);
    expect(parsed.z).toBeCloseTo(3);
  });

  it('parse handles extra whitespace', () => {
    const p = Point3D.parse('  1   2   3  ');
    expect(p.equals(new Point3D(1, 2, 3))).toBe(true);
  });

  it('parse throws when fewer than 3 components', () => {
    expect(() => Point3D.parse('1 2')).toThrow();
  });

  it('constants have expected values', () => {
    expect(Point3D.Zero.equals(new Point3D(0, 0, 0))).toBe(true);
    expect(Point3D.XDirection.equals(new Point3D(1, 0, 0))).toBe(true);
    expect(Point3D.YDirection.equals(new Point3D(0, 1, 0))).toBe(true);
    expect(Point3D.ZDirection.equals(new Point3D(0, 0, 1))).toBe(true);
    expect(Point3D.MaxValue.x).toBe(Number.MAX_VALUE);
  });
});
