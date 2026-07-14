import { describe, it, expect, beforeEach } from 'vitest';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { Beam } from '../src/data/Beam';
import { Pillar } from '../src/data/Pillar';
import { Floor } from '../src/data/Floor';
import { Point3D } from '../src/math/Point3D';
import { Layer } from '../src/ui/Layer';

const doc = Document.instance;

beforeEach(() => {
  doc.init();
});

describe('Document', () => {
  it('init clears all data and layers', () => {
    doc.add(new Node(new Point3D(0, 0, 0)));
    doc.addLayer(new Layer(0, 'L0'));
    doc.init();
    expect(doc.allDataList.length).toBe(0);
    expect(doc.nodeList.length).toBe(0);
    expect(doc.layers.length).toBe(0);
    expect(doc.shownLayer).toBeNull();
  });

  it('assigns numbers per-type starting at 0 on add', () => {
    const n0 = new Node(new Point3D(0, 0, 0));
    const n1 = new Node(new Point3D(1, 0, 0));
    const n2 = new Node(new Point3D(2, 0, 0));
    doc.add(n0);
    doc.add(n1);
    doc.add(n2);

    const beam = new Beam(n0, n1);
    const pillar = new Pillar(n0, n2);
    doc.add(beam);
    doc.add(pillar);

    // Nodes 0..2
    expect(doc.nodeList.map((n) => n.number).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    // Members (Beam + Pillar) share the member counter starting at 0
    const memberNums = doc.memberList.map((m) => m.number).sort((a, b) => a - b);
    expect(memberNums).toEqual([0, 1]);
  });

  it('sorts by type priority Node -> Beam -> Pillar then compareTo', () => {
    const n0 = new Node(new Point3D(0, 0, 0));
    const n1 = new Node(new Point3D(1, 0, 0));
    const n2 = new Node(new Point3D(0, 0, 3000));
    doc.add(n0);
    doc.add(n1);
    doc.add(n2);

    const pillar = new Pillar(n0, n2);
    const beam = new Beam(n0, n1);
    // add pillar before beam to confirm sort reorders by type priority
    doc.add(pillar);
    doc.add(beam);

    const data = doc.allDataList;
    // first three are nodes
    expect(data[0]).toBeInstanceOf(Node);
    expect(data[1]).toBeInstanceOf(Node);
    expect(data[2]).toBeInstanceOf(Node);
    // Beam comes before Pillar
    expect(data[3]).toBeInstanceOf(Beam);
    expect(data[4]).toBeInstanceOf(Pillar);
  });

  it('sorts nodes by compareTo (z then y then x ascending)', () => {
    const a = new Node(new Point3D(5, 5, 100)); // higher z -> last
    const b = new Node(new Point3D(0, 0, 0)); // lowest -> first
    const c = new Node(new Point3D(0, 1, 0)); // same z as b, larger y
    doc.add(a);
    doc.add(b);
    doc.add(c);

    const nodes = doc.nodeList;
    expect(nodes[0]).toBe(b);
    expect(nodes[1]).toBe(c);
    expect(nodes[2]).toBe(a);
  });

  it('getNodeAt respects the search range', () => {
    const n = new Node(new Point3D(0, 0, 0));
    doc.add(n);

    // within default range 0.5
    expect(doc.getNodeAt(new Point3D(0.4, 0, 0))).toBe(n);
    // outside default range
    expect(doc.getNodeAt(new Point3D(0.6, 0, 0))).toBeNull();
    // larger explicit range
    expect(doc.getNodeAt(new Point3D(0.6, 0, 0), 1.0)).toBe(n);
    // exactly on the boundary (<=)
    expect(doc.getNodeAt(new Point3D(0.5, 0, 0))).toBe(n);
  });

  it('getNodeByNumber finds the node with the given number', () => {
    const n0 = new Node(new Point3D(0, 0, 0));
    const n1 = new Node(new Point3D(1, 0, 0));
    doc.add(n0);
    doc.add(n1);
    expect(doc.getNodeByNumber(0)).toBe(n0);
    expect(doc.getNodeByNumber(1)).toBe(n1);
    expect(doc.getNodeByNumber(99)).toBeNull();
  });

  it('getMemberOf finds a member regardless of node order', () => {
    const n0 = new Node(new Point3D(0, 0, 0));
    const n1 = new Node(new Point3D(1, 0, 0));
    doc.add(n0);
    doc.add(n1);
    const beam = new Beam(n0, n1);
    doc.add(beam);
    expect(doc.getMemberOf(n0, n1)).toBe(beam);
    expect(doc.getMemberOf(n1, n0)).toBe(beam);
  });

  it('getPlaneOf finds a plane by its node set', () => {
    const ns = [
      new Node(new Point3D(0, 0, 0)),
      new Node(new Point3D(1, 0, 0)),
      new Node(new Point3D(1, 1, 0)),
      new Node(new Point3D(0, 1, 0)),
    ];
    ns.forEach((n) => doc.add(n));
    const floor = new Floor(ns);
    doc.add(floor);
    expect(doc.getPlaneOf(ns)).toBe(floor);
    expect(doc.getPlaneOf([ns[0], ns[1]])).toBeNull();
  });

  it('addLayer rejects duplicate posZ', () => {
    expect(doc.addLayer(new Layer(0, 'L0'))).toBe(true);
    expect(doc.addLayer(new Layer(3000, 'L1'))).toBe(true);
    // duplicate posZ
    expect(doc.addLayer(new Layer(0, 'dup'))).toBe(false);
    expect(doc.layers.length).toBe(2);
  });

  it('addLayer keeps layers sorted by posZ', () => {
    doc.addLayer(new Layer(3000, 'L1'));
    doc.addLayer(new Layer(0, 'L0'));
    doc.addLayer(new Layer(6000, 'L2'));
    expect(doc.layers.map((l) => l.posZ)).toEqual([0, 3000, 6000]);
  });

  it('updateLayer validates, re-sorts, rolls back duplicates, and notifies once', () => {
    const lower = new Layer(0, 'lower');
    const upper = new Layer(3000, 'upper');
    doc.addLayer(lower);
    doc.addLayer(upper);
    const kinds: string[] = [];
    const unsubscribe = doc.subscribe((event) => kinds.push(event.kind));

    expect(doc.updateLayer(lower, { name: 'roof', posZ: 6000 })).toBe(true);
    expect(doc.layers).toEqual([upper, lower]);
    expect(kinds).toEqual(['layers']);

    expect(() => doc.updateLayer(lower, { name: 'invalid', posZ: 3000 })).toThrow(/duplicate layer elevation/);
    unsubscribe();
    expect(lower.name).toBe('roof');
    expect(lower.posZ).toBe(6000);
    expect(doc.layers).toEqual([upper, lower]);
    expect(kinds).toEqual(['layers']);
  });

  it('sceneCenter is the average of node positions', () => {
    // empty -> origin
    expect(doc.sceneCenter.equals(new Point3D(0, 0, 0))).toBe(true);

    doc.add(new Node(new Point3D(0, 0, 0)));
    doc.add(new Node(new Point3D(2, 0, 0)));
    doc.add(new Node(new Point3D(0, 4, 6)));
    const c = doc.sceneCenter;
    expect(c.x).toBeCloseTo(2 / 3);
    expect(c.y).toBeCloseTo(4 / 3);
    expect(c.z).toBeCloseTo(2);
  });

  it('add is idempotent for the same instance', () => {
    const n = new Node(new Point3D(0, 0, 0));
    doc.add(n);
    doc.add(n);
    expect(doc.nodeList.length).toBe(1);
  });

  it('remove deletes an unreferenced node', () => {
    const n = new Node(new Point3D(0, 0, 0));
    doc.add(n);
    expect(() => doc.remove(n)).not.toThrow();
    expect(doc.nodeList.length).toBe(0);
  });

  // B-1: a Node referenced by a Member must not be removable.
  it('remove throws for a node referenced by a beam', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1000, 0, 0));
    doc.add(a);
    doc.add(b);
    doc.add(new Beam(a, b));
    expect(() => doc.remove(a)).toThrow();
    expect(doc.nodeList.length).toBe(2);
  });

  it('remove allows a node once its referencing member is gone', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1000, 0, 0));
    doc.add(a);
    doc.add(b);
    const beam = new Beam(a, b);
    doc.add(beam);
    doc.remove(beam);
    expect(() => doc.remove(a)).not.toThrow();
    expect(doc.nodeList.length).toBe(1);
  });

  it('rejects a member that references a Node outside the Document', () => {
    const inside = new Node(new Point3D(0, 0, 0));
    const outside = new Node(new Point3D(1, 0, 0));
    doc.add(inside);

    expect(() => doc.add(new Beam(inside, outside))).toThrow(/does not belong/);
    expect(doc.allDataList).toEqual([inside]);
  });

  it('addMany atomically adds Nodes and their referencing member', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1, 0, 0));
    const beam = new Beam(a, b);

    expect(() => doc.addMany([a, b, beam])).not.toThrow();
    expect(doc.nodeList).toHaveLength(2);
    expect(doc.memberList).toEqual([beam]);
  });

  it('bulkLoad copies input arrays and preserves the previous model on validation failure', () => {
    const original = new Node(new Point3D(9, 9, 9));
    doc.bulkLoad([original], [new Layer(0, 'L0')]);

    const inside = new Node(new Point3D(0, 0, 0));
    const outside = new Node(new Point3D(1, 0, 0));
    const candidate = [inside];
    expect(() => doc.bulkLoad([...candidate, new Beam(inside, outside)], [new Layer(100, 'bad')])).toThrow(
      /does not belong/,
    );
    candidate.push(outside);

    expect(doc.nodeList).toEqual([original]);
    expect(doc.layers.map((layer) => layer.name)).toEqual(['L0']);
  });

  it('update validates, reindexes, invalidates once, and notifies subscribers once', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1, 0, 0));
    doc.addMany([a, b, new Beam(a, b)]);
    const kinds: string[] = [];
    const unsubscribe = doc.subscribe((event) => kinds.push(event.kind));

    doc.update(() => {
      a.pos = new Point3D(2, 0, 0);
      b.pos = new Point3D(-1, 0, 0);
    });

    unsubscribe();
    expect(kinds).toEqual(['model']);
    expect(doc.nodeList).toEqual([b, a]);
    expect(b.number).toBe(0);
    expect(a.number).toBe(1);
  });

  it('update rolls back property changes when the resulting model is invalid', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1, 0, 0));
    doc.addMany([a, b, new Beam(a, b)]);
    const before = b.pos.clone();
    let notifications = 0;
    const unsubscribe = doc.subscribe(() => notifications++);

    expect(() =>
      doc.update(() => {
        b.pos = a.pos.clone();
      }),
    ).toThrow(/member length/);

    unsubscribe();
    expect(b.pos.equals(before)).toBe(true);
    expect(notifications).toBe(0);
  });

  it('removeMany can remove a member and its endpoint in one atomic operation', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1, 0, 0));
    const beam = new Beam(a, b);
    doc.addMany([a, b, beam]);

    doc.removeMany([beam, a]);

    expect(doc.nodeList).toEqual([b]);
    expect(doc.memberList).toHaveLength(0);
  });
});
