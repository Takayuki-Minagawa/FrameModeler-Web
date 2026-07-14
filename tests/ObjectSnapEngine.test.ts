import { describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import type { Member } from '../src/data/Member';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import {
  cycleObjectSnapCandidate,
  getObjectSnapCandidateKind,
  getObjectSnapKindInfo,
  ObjectSnapEngine,
  type AnchorConstraintRequest,
  type ObjectSnapRequest,
} from '../src/ui/ObjectSnapEngine';

const engine = new ObjectSnapEngine();

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

function beam(from: Node, to: Node): Beam {
  return new Beam(from, to);
}

interface ResolveOptions {
  pointer: { x: number; y: number };
  position?: Point3D;
  nodes?: Node[];
  members?: Member[];
  workPlaneZ?: number;
  gridSpacing?: number;
  tolerancePx?: number;
  project?: ObjectSnapRequest['project'];
  constraints?: AnchorConstraintRequest;
}

function request(options: ResolveOptions): ObjectSnapRequest {
  const workPlaneZ = options.workPlaneZ ?? 0;
  return {
    position: options.position ?? new Point3D(options.pointer.x, options.pointer.y, workPlaneZ),
    screenPoint: options.pointer,
    workPlaneZ,
    gridSpacing: options.gridSpacing ?? 10,
    tolerancePx: options.tolerancePx ?? 10,
    nodes: options.nodes ?? [],
    members: options.members ?? [],
    project: options.project ?? ((point) => ({ x: point.x, y: point.y })),
    constraints: options.constraints,
  };
}

function resolve(options: ResolveOptions) {
  return engine.resolve(request(options));
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

  it('generates stable world X/Y axis constraints from an anchor', () => {
    const anchor = new Point3D(10, 20, 500);
    const xAxis = resolve({
      pointer: { x: 34, y: 23 },
      position: new Point3D(34, 23, 500),
      workPlaneZ: 500,
      constraints: { anchor, kinds: ['axis-x', 'axis-y'] },
      tolerancePx: 5,
    });
    expect(getObjectSnapCandidateKind(xAxis)).toBe('axis-x');
    expect(xAxis.kind).toBe('none');
    expect(xAxis.position).toEqual(new Point3D(34, 20, 500));

    const yAxis = resolve({
      pointer: { x: 13, y: 44 },
      position: new Point3D(13, 44, 500),
      workPlaneZ: 500,
      constraints: { anchor, kinds: ['axis-x', 'axis-y'] },
      tolerancePx: 5,
    });
    expect(getObjectSnapCandidateKind(yAxis)).toBe('axis-y');
    expect(yAxis.position).toEqual(new Point3D(10, 44, 500));
  });

  it('keeps screen horizontal/vertical distinct from world axes in a rotated view', () => {
    const project = (point: Point3D) => ({ x: point.y, y: -point.x });
    const screenToWorkPlane = (screen: { x: number; y: number }) => new Point3D(-screen.y, screen.x, 200);
    const result = resolve({
      pointer: { x: 40, y: 3 },
      position: new Point3D(-3, 40, 200),
      workPlaneZ: 200,
      project,
      constraints: {
        anchor: new Point3D(0, 0, 200),
        kinds: ['horizontal', 'vertical'],
        screenToWorkPlane,
      },
      tolerancePx: 5,
    });

    expect(getObjectSnapCandidateKind(result)).toBe('horizontal');
    expect(result.position).toEqual(new Point3D(0, 40, 200));
    expect(result.distancePx).toBe(3);
  });

  it('projects onto the line through anchor orthogonal to a reference XY direction', () => {
    const result = resolve({
      pointer: { x: 10, y: -8 },
      position: new Point3D(10, -8, 0),
      constraints: {
        anchor: new Point3D(0, 0, 0),
        kinds: ['orthogonal'],
        orthogonalTo: new Point3D(1, 1, 0),
      },
      tolerancePx: 2,
    });

    expect(getObjectSnapCandidateKind(result)).toBe('orthogonal');
    expect(result.position.x).toBeCloseTo(9);
    expect(result.position.y).toBeCloseTo(-9);
    expect(result.position.x + result.position.y).toBeCloseTo(0);
  });

  it('enumerates equal-distance candidates deterministically and cycles by stable ID', () => {
    const upper = node(0, 1);
    const lower = node(0, -1);
    const snapRequest = request({
      pointer: { x: 0, y: 0 },
      nodes: [upper, lower],
      tolerancePx: 2,
    });

    const candidates = engine.resolveCandidates(snapRequest);
    const repeated = engine.resolveCandidates(snapRequest);
    const reordered = engine.resolveCandidates({ ...snapRequest, nodes: [lower, upper] });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.distancePx)).toEqual([1, 1]);
    expect(candidates.map((candidate) => candidate.candidateId)).toEqual(
      repeated.map((candidate) => candidate.candidateId),
    );
    expect(candidates.map((candidate) => candidate.source)).toEqual([upper, lower]);
    const idFor = (list: ReadonlyArray<(typeof candidates)[number]>, source: Node) =>
      list.find((candidate) => candidate.source === source)?.candidateId;
    expect(idFor(reordered, upper)).toBe(idFor(candidates, upper));
    expect(idFor(reordered, lower)).toBe(idFor(candidates, lower));

    const next = cycleObjectSnapCandidate(candidates, candidates[0].candidateId, 1);
    expect(next?.index).toBe(1);
    expect(next?.candidate.source).toBe(lower);
    const wrapped = cycleObjectSnapCandidate(candidates, next?.candidate.candidateId, 1);
    expect(wrapped?.index).toBe(0);
    expect(wrapped?.candidate.source).toBe(upper);
    const previous = cycleObjectSnapCandidate(candidates, candidates[0].candidateId, -1);
    expect(previous?.index).toBe(1);
    expect(cycleObjectSnapCandidate(candidates, null, 1)?.index).toBe(0);
    expect(cycleObjectSnapCandidate(candidates, 'removed-candidate', -1)?.index).toBe(1);
  });

  it('keeps object snaps ahead of exact constraint candidates and exposes glyph metadata', () => {
    const existing = node(4, 0);
    const snapRequest = request({
      pointer: { x: 0, y: 0 },
      nodes: [existing],
      constraints: {
        anchor: new Point3D(-20, 0, 0),
        kinds: ['axis-x'],
      },
      tolerancePx: 5,
    });
    const candidates = engine.resolveCandidates(snapRequest);

    expect(getObjectSnapCandidateKind(candidates[0])).toBe('node');
    expect(getObjectSnapCandidateKind(candidates[1])).toBe('axis-x');
    expect(getObjectSnapKindInfo('axis-x')).toEqual({
      kind: 'axis-x',
      labelKey: 'snap.axisX',
      label: 'X axis',
      glyph: 'x-axis',
    });
    expect(getObjectSnapKindInfo('orthogonal').glyph).toBe('right-angle');
  });

  it('ignores a zero orthogonal reference without producing non-finite coordinates', () => {
    const result = resolve({
      pointer: { x: 13, y: 17 },
      constraints: {
        anchor: new Point3D(0, 0, 0),
        kinds: ['orthogonal'],
        orthogonalTo: new Point3D(0, 0, 0),
      },
      gridSpacing: 10,
    });

    expect(getObjectSnapCandidateKind(result)).toBe('grid');
    expect(result.position).toEqual(new Point3D(10, 20, 0));
  });

  it('deduplicates coincident world/screen constraints while retaining alternate kind metadata', () => {
    const snapRequest = request({
      pointer: { x: 20, y: 2 },
      position: new Point3D(20, 2, 0),
      constraints: {
        anchor: new Point3D(0, 0, 0),
        kinds: ['axis-x', 'horizontal'],
        screenToWorkPlane: (screen) => new Point3D(screen.x, screen.y, 0),
      },
      tolerancePx: 3,
    });

    const candidates = engine.resolveCandidates(snapRequest);
    expect(candidates).toHaveLength(1);
    expect(getObjectSnapCandidateKind(candidates[0])).toBe('axis-x');
    expect(candidates[0].equivalentKinds).toEqual(['horizontal']);
    expect(candidates[0].position).toEqual(new Point3D(20, 0, 0));
  });
});
