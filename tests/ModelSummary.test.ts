import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { BearWall } from '../src/data/BearWall';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { polygonArea, summarizeModel } from '../src/data/ModelSummary';
import { Node } from '../src/data/Node';
import { Pillar } from '../src/data/Pillar';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

describe('polygonArea', () => {
  it('measures flat, vertical, inclined and concave polygons', () => {
    const p = (x: number, y: number, z: number): Point3D => new Point3D(x, y, z);
    expect(polygonArea([p(0, 0, 0), p(4, 0, 0), p(4, 3, 0), p(0, 3, 0)])).toBeCloseTo(12);
    expect(polygonArea([p(0, 0, 0), p(4, 0, 0), p(4, 0, 3), p(0, 0, 3)])).toBeCloseTo(12);
    // 3-4-5 の斜面: 幅 2 × 斜辺 5
    expect(polygonArea([p(0, 0, 0), p(0, 2, 0), p(4, 2, 3), p(4, 0, 3)])).toBeCloseTo(10);
    // L字形（凹多角形）
    expect(polygonArea([p(0, 0, 0), p(2, 0, 0), p(2, 1, 0), p(1, 1, 0), p(1, 2, 0), p(0, 2, 0)])).toBeCloseTo(3);
    // 頂点の向きに依存しない
    expect(polygonArea([p(0, 3, 0), p(4, 3, 0), p(4, 0, 0), p(0, 0, 0)])).toBeCloseTo(12);
    expect(polygonArea([p(0, 0, 0), p(1, 0, 0)])).toBe(0);
  });
});

describe('summarizeModel', () => {
  it('returns zero counts and no bounds for an empty model', () => {
    const summary = summarizeModel(doc);
    expect(summary.counts.every((entry) => entry.count === 0)).toBe(true);
    expect(summary.counts.map((entry) => entry.kind)).toEqual([
      'node',
      'beam',
      'pillar',
      'truss',
      'spring',
      'bearWall',
      'wall',
      'floor',
      'support',
      'constraint',
    ]);
    expect(summary.memberRows).toEqual([]);
    expect(summary.planeRows).toEqual([]);
    expect(summary.bounds).toBeNull();
    expect(summary.totalMemberLength).toBe(0);
    expect(summary.totalPlaneArea).toBe(0);
  });

  it('groups lengths and areas by type and section in registry order', () => {
    const n = [node(0, 0), node(6000, 0), node(6000, 4000), node(0, 4000)];
    const top = [node(0, 0, 3000), node(6000, 0, 3000)];
    const g1a = new Beam(n[0], n[1]);
    const g1b = new Beam(n[3], n[2]);
    const g10 = new Beam(n[1], n[2]);
    g10.section = 'G10';
    const g2 = new Beam(n[0], n[3]);
    g2.section = ' G2 ';
    const pillar = new Pillar(n[0], top[0]);
    const truss = new Truss(n[0], n[2]);
    truss.area = 100;
    truss.section = '';
    const floor = new Floor(n);
    const wall = new BearWall([n[0], n[1], top[1], top[0]]);
    doc.addMany([...n, ...top, g1a, g1b, g10, g2, pillar, truss, floor, wall, new Support(n[0], ['uz'])]);

    const summary = summarizeModel(doc);
    const count = (kind: string): number => summary.counts.find((entry) => entry.kind === kind)!.count;
    expect(count('node')).toBe(6);
    expect(count('beam')).toBe(4);
    expect(count('support')).toBe(1);

    // 断面は数値を考慮した自然順（G1, G2, G10）で、前後の空白は無視する。
    expect(summary.memberRows.map((row) => [row.kind, row.section, row.count, Math.round(row.length)])).toEqual([
      ['beam', 'G1', 2, 12000],
      ['beam', 'G2', 1, 4000],
      ['beam', 'G10', 1, 4000],
      ['pillar', 'C1', 1, 3000],
      ['truss', '', 1, Math.round(Math.hypot(6000, 4000))],
    ]);
    expect(summary.planeRows.map((row) => [row.kind, row.section, row.count, row.area])).toEqual([
      ['bearWall', 'V1', 1, 18_000_000],
      ['floor', 'S1', 1, 24_000_000],
    ]);
    expect(summary.totalMemberLength).toBeCloseTo(12000 + 4000 + 4000 + 3000 + Math.hypot(6000, 4000));
    expect(summary.totalPlaneArea).toBe(42_000_000);
    expect(summary.bounds?.min.toString()).toBe(new Point3D(0, 0, 0).toString());
    expect(summary.bounds?.max.toString()).toBe(new Point3D(6000, 4000, 3000).toString());
  });
});
