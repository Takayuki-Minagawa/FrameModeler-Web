import { describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import type { Member } from '../src/data/Member';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import { ObjectSnapEngine, type ObjectSnapRequest } from '../src/ui/ObjectSnapEngine';

const engine = new ObjectSnapEngine();

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

function beam(from: Node, to: Node): Beam {
  return new Beam(from, to);
}

function resolve(options: {
  pointer: { x: number; y: number };
  position?: Point3D;
  nodes?: Node[];
  members?: Member[];
  workPlaneZ?: number;
  gridSpacing?: number;
  tolerancePx?: number;
  project?: ObjectSnapRequest['project'];
}) {
  const workPlaneZ = options.workPlaneZ ?? 0;
  return engine.resolve({
    position: options.position ?? new Point3D(options.pointer.x, options.pointer.y, workPlaneZ),
    screenPoint: options.pointer,
    workPlaneZ,
    gridSpacing: options.gridSpacing ?? 10,
    tolerancePx: options.tolerancePx ?? 10,
    nodes: options.nodes ?? [],
    members: options.members ?? [],
    project: options.project ?? ((point) => ({ x: point.x, y: point.y })),
  });
}

describe('ObjectSnapEngine', () => {
  it('snaps to a connected member endpoint on the current work plane', () => {
    const start = node(0, 0);
    const end = node(100, 0);
    const member = beam(start, end);

    const result = resolve({ pointer: { x: 4, y: 3 }, nodes: [start, end], members: [member] });

    expect(result.kind).toBe('endpoint');
    expect(result.position).toEqual(new Point3D(0, 0, 0));
    expect(result.distancePx).toBe(5);
    expect(result.source).toBe(start);
  });

  it('reports an isolated existing point as a node snap', () => {
    const existing = node(25, 40);

    const result = resolve({ pointer: { x: 27, y: 43 }, nodes: [existing] });

    expect(result.kind).toBe('node');
    expect(result.position).toEqual(existing.pos);
    expect(result.source).toBe(existing);
  });

  it('snaps to a member midpoint when no endpoint or node is in tolerance', () => {
    const start = node(0, 0);
    const end = node(100, 0);
    const member = beam(start, end);

    const result = resolve({
      pointer: { x: 53, y: 2 },
      nodes: [start, end],
      members: [member],
      tolerancePx: 6,
    });

    expect(result.kind).toBe('midpoint');
    expect(result.position).toEqual(new Point3D(50, 0, 0));
    expect(result.source).toBe(member);
  });

  it('uses the declared endpoint/node priority before a closer midpoint', () => {
    const start = node(0, 0);
    const end = node(100, 0);
    const member = beam(start, end);
    const existing = node(58, 0);

    const result = resolve({
      pointer: { x: 50, y: 0 },
      nodes: [start, end, existing],
      members: [member],
    });

    expect(result.kind).toBe('node');
    expect(result.position).toEqual(existing.pos);
    expect(result.distancePx).toBe(8);
  });

  it('finds a 2D centerline intersection that is not a member midpoint', () => {
    const horizontal = beam(node(0, 20), node(100, 20));
    const vertical = beam(node(25, 0), node(25, 100));
    const nodes = [horizontal.nodeI!, horizontal.nodeJ!, vertical.nodeI!, vertical.nodeJ!];

    const result = resolve({
      pointer: { x: 26, y: 21 },
      nodes,
      members: [horizontal, vertical],
      tolerancePx: 5,
    });

    expect(result.kind).toBe('intersection');
    expect(result.position).toEqual(new Point3D(25, 20, 0));
    expect(result.distancePx).toBeCloseTo(Math.SQRT2);
    expect(result.source).toEqual([horizontal, vertical]);
  });

  it('falls back to the XY grid when no object candidate is near', () => {
    const result = resolve({ pointer: { x: 24, y: 36 }, gridSpacing: 10, tolerancePx: 3 });

    expect(result.kind).toBe('grid');
    expect(result.position).toEqual(new Point3D(20, 40, 0));
    expect(result.source).toBeNull();
  });

  it('filters object candidates to the current work plane', () => {
    const upperNode = node(24, 36, 3000);
    const upperBeam = beam(node(0, 36, 3000), node(100, 36, 3000));

    const result = resolve({
      pointer: { x: 24, y: 36 },
      nodes: [upperNode, upperBeam.nodeI!, upperBeam.nodeJ!],
      members: [upperBeam],
      workPlaneZ: 0,
      tolerancePx: 10,
    });

    expect(result.kind).toBe('grid');
    expect(result.position.z).toBe(0);
  });

  it('measures tolerance after projection in CSS pixels instead of world units', () => {
    const farInWorldButNearOnScreen = node(100, 0);

    const result = resolve({
      pointer: { x: 0, y: 0 },
      position: new Point3D(0, 0, 0),
      nodes: [farInWorldButNearOnScreen],
      tolerancePx: 6,
      project: (point) => ({ x: point.x / 20, y: point.y / 20 }),
    });

    expect(result.kind).toBe('node');
    expect(result.distancePx).toBe(5);
    expect(result.position.x).toBe(100);
  });

  it('does not invent an intersection for parallel or overlapping members', () => {
    const first = beam(node(0, 0), node(100, 0));
    const second = beam(node(25, 0), node(75, 0));

    const result = resolve({
      pointer: { x: 40, y: 1 },
      nodes: [first.nodeI!, first.nodeJ!, second.nodeI!, second.nodeJ!],
      members: [first, second],
      tolerancePx: 3,
    });

    expect(result.kind).toBe('grid');
  });
});
