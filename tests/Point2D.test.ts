import { describe, it, expect } from 'vitest';
import { Point2D } from '../src/math/Point2D';

describe('Point2D', () => {
  it('constructs with defaults and values, and clones', () => {
    expect(new Point2D().equals(new Point2D(0, 0))).toBe(true);
    const p = new Point2D(1, 2);
    const c = p.clone();
    expect(c).not.toBe(p);
    expect(c.equals(p)).toBe(true);
  });

  it('add / sub / negate / scale / div', () => {
    const a = new Point2D(1, 2);
    const b = new Point2D(3, 4);
    expect(a.add(b).equals(new Point2D(4, 6))).toBe(true);
    expect(b.sub(a).equals(new Point2D(2, 2))).toBe(true);
    expect(a.negate().equals(new Point2D(-1, -2))).toBe(true);
    expect(a.scale(3).equals(new Point2D(3, 6))).toBe(true);
    expect(b.div(2).equals(new Point2D(1.5, 2))).toBe(true);
  });

  it('length / lengthSquared', () => {
    const p = new Point2D(3, 4);
    expect(p.lengthSquared).toBe(25);
    expect(p.length).toBeCloseTo(5);
  });

  it('normalize and getNormalized', () => {
    const p = new Point2D(3, 4);
    const n = p.getNormalized();
    expect(n.length).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
    expect(p.x).toBe(3); // original untouched

    const m = new Point2D(3, 4);
    m.normalize();
    expect(m.length).toBeCloseTo(1);
  });

  it('normalize of zero vector is a no-op', () => {
    const p = new Point2D(0, 0);
    p.normalize();
    expect(p.equals(new Point2D(0, 0))).toBe(true);
  });

  it('equals compares exact values', () => {
    expect(new Point2D(1, 2).equals(new Point2D(1, 2))).toBe(true);
    expect(new Point2D(1, 2).equals(new Point2D(1, 2.0001))).toBe(false);
  });

  it('static dotProduct', () => {
    expect(Point2D.dotProduct(new Point2D(1, 2), new Point2D(3, 4))).toBe(11);
  });

  it('static crossProduct returns a scalar', () => {
    const c = Point2D.crossProduct(new Point2D(1, 0), new Point2D(0, 1));
    expect(typeof c).toBe('number');
    expect(c).toBe(1);
    expect(Point2D.crossProduct(new Point2D(2, 3), new Point2D(4, 5))).toBe(2 * 5 - 3 * 4);
  });

  it('toString formats as "x y"', () => {
    expect(new Point2D(1, 2).toString()).toBe('1 2');
  });

  it('parse and toString round trip', () => {
    const p = new Point2D(1.5, -2.25);
    const parsed = Point2D.parse(p.toString());
    expect(parsed.x).toBeCloseTo(1.5);
    expect(parsed.y).toBeCloseTo(-2.25);
  });

  it('parse handles extra whitespace', () => {
    expect(Point2D.parse('  1   2  ').equals(new Point2D(1, 2))).toBe(true);
  });

  it('parse throws when fewer than 2 components', () => {
    expect(() => Point2D.parse('1')).toThrow();
  });

  it('constants have expected values', () => {
    expect(Point2D.Zero.equals(new Point2D(0, 0))).toBe(true);
    expect(Point2D.XDirection.equals(new Point2D(1, 0))).toBe(true);
    expect(Point2D.YDirection.equals(new Point2D(0, 1))).toBe(true);
  });
});
