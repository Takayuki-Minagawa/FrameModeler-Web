import { describe, it, expect, beforeEach } from 'vitest';
import { Point3D } from '../src/math/Point3D';
import { compareNumbers } from '../src/math/compare';
import { Node } from '../src/data/Node';
import { Beam } from '../src/data/Beam';
import { Wall } from '../src/data/Wall';
import { Layer } from '../src/ui/Layer';
import { Document } from '../src/data/Document';
import { deserializeJson } from '../src/io/JsonDeserializer';

describe('compareNumbers (D-5)', () => {
  it('compares pairs in order', () => {
    expect(compareNumbers([1, 2])).toBe(-1);
    expect(compareNumbers([2, 1])).toBe(1);
    expect(compareNumbers([1, 1], [3, 4])).toBe(-1);
    expect(compareNumbers([1, 1], [2, 2], [5, 5])).toBe(0);
  });
});

describe('Point3D.average (D-9)', () => {
  it('returns origin for empty input', () => {
    expect(Point3D.average([]).equals(new Point3D(0, 0, 0))).toBe(true);
  });
  it('averages coordinates', () => {
    const avg = Point3D.average([new Point3D(0, 0, 0), new Point3D(2, 4, 6)]);
    expect(avg.x).toBeCloseTo(1);
    expect(avg.y).toBeCloseTo(2);
    expect(avg.z).toBeCloseTo(3);
  });
});

describe('existsOn via zRange (D-4)', () => {
  const layer = new Layer(1000, 'L');
  it('node matches only its own Z', () => {
    expect(new Node(new Point3D(0, 0, 1000)).existsOn(layer)).toBe(true);
    expect(new Node(new Point3D(0, 0, 0)).existsOn(layer)).toBe(false);
    expect(new Node(new Point3D(0, 0, 1000)).existsOn(null)).toBe(false);
  });
  it('member spans the layer Z range', () => {
    const beam = new Beam(new Node(new Point3D(0, 0, 0)), new Node(new Point3D(0, 0, 2000)));
    expect(beam.existsOn(layer)).toBe(true);
    expect(beam.existsOn(new Layer(3000, 'H'))).toBe(false);
  });
});

describe('Wall.wallLength (D-11)', () => {
  it('returns distance between first two nodes', () => {
    const wall = new Wall([new Node(new Point3D(0, 0, 0)), new Node(new Point3D(3, 4, 0))]);
    expect(wall.wallLength).toBeCloseTo(5);
  });
});

describe('JSON robustness (I-7/I-8)', () => {
  beforeEach(() => Document.instance.init());

  it('wraps malformed JSON in a friendly error', () => {
    expect(() => deserializeJson('{ not json')).toThrow(/Invalid JSON document/);
  });

  it('rejects duplicate layer elevations instead of silently dropping data (I-8)', () => {
    Document.instance.bulkLoad([new Node(new Point3D(1, 2, 3))], [new Layer(100, 'existing')]);
    expect(() =>
      deserializeJson(
        JSON.stringify({
          nodes: [],
          layers: [
            { name: 'A', posZ: 0 },
            { name: 'B', posZ: 0 },
            { name: 'C', posZ: 3000 },
          ],
        }),
      ),
    ).toThrow(/duplicate layer elevation/);
    expect(Document.instance.nodeList).toHaveLength(1);
    expect(Document.instance.layers.map((layer) => layer.name)).toEqual(['existing']);
  });
});
