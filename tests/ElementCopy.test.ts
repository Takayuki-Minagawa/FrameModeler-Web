import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { planElementCopies, repeatedOffsetTransforms } from '../src/data/ElementCopy';
import { Floor } from '../src/data/Floor';
import { Node } from '../src/data/Node';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

describe('planElementCopies', () => {
  it('chains repeated copies through shared end nodes instead of duplicating them', () => {
    const a = node(0, 0);
    const b = node(6000, 0);
    const beam = new Beam(a, b);
    beam.section = 'G2';
    doc.addMany([a, b, beam]);

    const additions = planElementCopies(doc, {
      nodes: [],
      elements: [beam],
      transforms: repeatedOffsetTransforms(new Point3D(6000, 0, 0), 3),
    });
    doc.addMany(additions);

    // 1スパン目の終点を2スパン目の始点として再利用するため、Nodeは3個だけ増える。
    expect(additions.filter((data) => data instanceof Node)).toHaveLength(3);
    expect(doc.nodeList.map((item) => item.pos.x)).toEqual([0, 6000, 12000, 18000, 24000]);
    expect(doc.memberList).toHaveLength(4);
    expect(doc.memberList.every((member) => member.section === 'G2')).toBe(true);
    expect(additions.every((data) => data.select === false)).toBe(true);
  });

  it('copies selected nodes, planes and supports and skips equivalents on a second run', () => {
    const corners = [node(0, 0), node(1000, 0), node(1000, 1000), node(0, 1000)];
    const floor = new Floor(corners);
    floor.weight = 3;
    const support = new Support(corners[0], ['uz']);
    const free = node(500, 500);
    free.mass = { values: [1, 1, 1, 0, 0, 0], translationalUnit: 'kg', rotationalUnit: 'kg*mm^2' };
    doc.addMany([...corners, free, floor, support]);

    const request = {
      nodes: [free],
      elements: [floor, support],
      transforms: repeatedOffsetTransforms(new Point3D(0, 0, 3000), 1),
    };
    const first = planElementCopies(doc, request);
    doc.addMany(first);
    expect(first.filter((data) => data instanceof Node)).toHaveLength(5);
    expect(doc.planeList).toHaveLength(2);
    const copiedFloor = doc.planeList.find((plane) => plane !== floor) as Floor;
    expect(copiedFloor.weight).toBe(3);
    expect(copiedFloor.nodeList.every((item) => item.pos.z === 3000)).toBe(true);
    const copiedFree = doc.nodeList.find((item) => item.pos.x === 500 && item.pos.z === 3000)!;
    expect(copiedFree.mass).toEqual(free.mass);
    expect(copiedFree.mass).not.toBe(free.mass);

    expect(planElementCopies(doc, request)).toEqual([]);
  });

  it('keeps coincident source nodes distinct so zero-length springs survive the copy', () => {
    const a = node(0, 0);
    const b = node(0, 0);
    const spring = new Spring(a, b);
    spring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }];
    doc.addMany([a, b, spring]);

    const additions = planElementCopies(doc, {
      nodes: [],
      elements: [spring],
      transforms: repeatedOffsetTransforms(new Point3D(1000, 0, 0), 2),
    });
    doc.addMany(additions);

    expect(doc.nodeList).toHaveLength(6);
    const springs = doc.memberList.filter((member) => member instanceof Spring);
    expect(springs).toHaveLength(3);
    expect(springs.every((member) => member.nodeI !== member.nodeJ)).toBe(true);
  });

  it('is a no-op for an identity transform and for an empty request', () => {
    const a = node(0, 0);
    const b = node(1000, 0);
    const beam = new Beam(a, b);
    doc.addMany([a, b, beam]);
    expect(
      planElementCopies(doc, { nodes: [a], elements: [beam], transforms: [(position) => position.clone()] }),
    ).toEqual([]);
    expect(
      planElementCopies(doc, {
        nodes: [],
        elements: [],
        transforms: repeatedOffsetTransforms(new Point3D(1, 0, 0), 1),
      }),
    ).toEqual([]);
  });

  it('builds cumulative offsets', () => {
    const transforms = repeatedOffsetTransforms(new Point3D(100, -50, 10), 3);
    expect(transforms.map((transform) => transform(new Point3D(1, 1, 1)).toString())).toEqual([
      new Point3D(101, -49, 11).toString(),
      new Point3D(201, -99, 21).toString(),
      new Point3D(301, -149, 31).toString(),
    ]);
  });
});
