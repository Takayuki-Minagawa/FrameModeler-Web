import { beforeEach, describe, expect, it } from 'vitest';
import { MergeNodesCommand, RemoveOrphanNodesCommand } from '../src/commands/DocumentCommands';
import { Beam } from '../src/data/Beam';
import { Constraint } from '../src/data/Constraint';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { Pillar } from '../src/data/Pillar';
import { findOrphanNodes, planNodeMerge } from '../src/data/NodeMerge';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

describe('planNodeMerge', () => {
  it('rejects invalid tolerances', () => {
    expect(() => planNodeMerge(doc, -1)).toThrow(RangeError);
    expect(() => planNodeMerge(doc, Number.NaN)).toThrow(RangeError);
  });

  it('merges nodes within the tolerance and keeps the earlier node', () => {
    const a = node(0, 0);
    const near = node(0.4, 0);
    const far = node(5, 0);
    const end = node(1000, 0);
    doc.addMany([a, near, far, end, new Beam(a, end), new Beam(near, far)]);

    const plan = planNodeMerge(doc, 1);
    expect([...plan.replacements]).toEqual([[near, a]]);
    expect(planNodeMerge(doc, 0.1).replacements.size).toBe(0);
    expect(planNodeMerge(doc, 0).replacements.size).toBe(0);
  });

  it('finds neighbours across grid cell boundaries', () => {
    const a = node(0.95, 0);
    const b = node(1.05, 0);
    doc.addMany([a, b]);
    expect(planNodeMerge(doc, 0.2).replacements.get(b)).toBe(a);
  });

  it('leaves nodes that an element deliberately keeps coincident completely alone', () => {
    const a = node(0, 0);
    const b = node(0, 0);
    const spring = new Spring(a, b);
    spring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }];
    const c = node(0, 0);
    const constraint = new Constraint(c, 'ux', [{ node: a, dof: 'ux', coefficient: 1 }]);
    const plain = node(0, 0);
    doc.addMany([a, b, c, plain, spring, constraint]);

    // a-b はばね、a-c は拘束で結ばれている。意図して重ねたNodeは、相手とも第三のNodeとも結合しない。
    expect(planNodeMerge(doc, 1).replacements.size).toBe(0);
    doc.execute(new MergeNodesCommand(1));
    expect(doc.nodeList).toHaveLength(4);
    expect(spring.nodeI).not.toBe(spring.nodeJ);
    expect(constraint.slaveNode).not.toBe(constraint.terms[0].node);
  });

  it('keeps a spring hub intact instead of fusing the nodes it separates', () => {
    const hub = node(0, 0);
    const left = node(0, 0);
    const right = node(0, 0);
    const farLeft = node(-1000, 0);
    const farRight = node(1000, 0);
    const springs = [new Spring(hub, left), new Spring(hub, right)];
    springs.forEach((spring) => (spring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }]));
    doc.addMany([hub, left, right, farLeft, farRight, ...springs, new Beam(farLeft, left), new Beam(right, farRight)]);

    const plan = doc.execute(new MergeNodesCommand(1));
    expect(plan.replacements.size).toBe(0);
    expect(plan.redundantElements).toEqual([]);
    expect(doc.memberList.filter((member) => member instanceof Spring)).toHaveLength(2);
    expect(doc.nodeList).toHaveLength(5);
  });

  it('does not let two nodes of one element collapse onto the same kept node', () => {
    // n1 と n2 は互いに許容差より離れているが、どちらも r からは許容差以内にある。
    const r = node(0, 0);
    const n1 = node(0.9, 0);
    const n2 = node(0, 0.9);
    const beam = new Beam(n1, n2);
    doc.addMany([r, n1, n2, beam, new Support(r, ['uz'])]);

    const plan = doc.execute(new MergeNodesCommand(1));
    expect([...plan.replacements]).toEqual([[n1, r]]);
    expect(beam.nodeI).toBe(r);
    expect(beam.nodeJ).toBe(n2);
    expect(doc.nodeList).toHaveLength(2);
  });

  it('skips a merge that would bend a plane but still applies the valid ones', () => {
    const upper = [node(0, 0), node(1000, 0), node(1000, 1000), node(0, 1000)];
    // 下の床は 0.5 mm 低く、1頂点だけ上の床の頂点と同じXYにある。
    const lower = [node(0, 0, -0.5), node(-1000, 0, -0.5), node(-1000, -1000, -0.5), node(0, -1000, -0.5)];
    const twinA = node(5000, 0);
    const twinB = node(5000, 0);
    const end = node(6000, 0);
    const floors = [new Floor(upper), new Floor(lower)];
    doc.addMany([...upper, ...lower, twinA, twinB, end, ...floors, new Beam(twinA, end), new Beam(twinB, end)]);

    const plan = doc.execute(new MergeNodesCommand(1));
    expect([...plan.replacements.keys()]).toHaveLength(1);
    expect(plan.replacements.has(upper[0])).toBe(false);
    expect(plan.replacements.has(lower[0])).toBe(false);
    expect(floors[0].nodeList).toEqual(upper);
    expect(floors[1].nodeList).toEqual(lower);
    expect(doc.memberList).toHaveLength(1);
  });

  it('moves an off-plane beam end onto the plane vertex rather than bending the plane', () => {
    const corners = [node(0, 0), node(1000, 0), node(1000, 1000), node(0, 1000)];
    const below = node(0, 0, -0.5);
    const far = node(-1000, 0, -0.5);
    const floor = new Floor(corners);
    const beam = new Beam(below, far);
    doc.addMany([...corners, below, far, floor, beam]);

    // Document の並び順では below (z=-0.5) が先だが、面材の頂点を残す。
    const plan = doc.execute(new MergeNodesCommand(1));
    expect([...plan.replacements]).toEqual([[below, corners[0]]]);
    expect(floor.nodeList).toEqual(corners);
    expect(beam.nodeI).toBe(corners[0]);
  });

  it('keeps the node that lies on a layer elevation', () => {
    doc.addLayer(new Layer(3000, '2F'));
    const offLayer = node(0, 0, 2999.5);
    const onLayer = node(0, 0, 3000);
    const end = node(1000, 0, 3000);
    const base = node(0, 0, 0);
    const beam = new Beam(onLayer, end);
    const pillar = new Pillar(base, offLayer);
    doc.addMany([offLayer, onLayer, end, base, beam, pillar]);

    const plan = doc.execute(new MergeNodesCommand(1));
    expect([...plan.replacements]).toEqual([[offLayer, onLayer]]);
    expect(beam.nodeI).toBe(onLayer);
    expect(pillar.nodeJ).toBe(onLayer);
  });

  it('keeps both nodes when each carries mass and transfers mass otherwise', () => {
    const mass = {
      values: [1, 1, 1, 0, 0, 0] as [number, number, number, number, number, number],
      translationalUnit: 'kg',
      rotationalUnit: 'kg*mm^2',
    };
    const a = node(0, 0);
    const b = node(0, 0);
    a.mass = { ...mass, values: [...mass.values] };
    b.mass = { ...mass, values: [...mass.values] };
    doc.addMany([a, b]);
    expect(planNodeMerge(doc, 1).replacements.size).toBe(0);

    a.mass = null;
    doc.execute(new MergeNodesCommand(1));
    expect(doc.nodeList).toEqual([a]);
    expect(a.mass).toEqual(mass);
    expect(a.mass).not.toBe(b.mass);
  });

  it('leaves nodes on locked layers and nodes of locked elements untouched', () => {
    const lower = new Layer(0, '1F');
    const upper = new Layer(3000, '2F', { locked: true });
    doc.addLayer(lower);
    doc.addLayer(upper);
    const a = node(0, 0, 3000);
    const b = node(0, 0, 3000);
    const base = node(0, 0, 0);
    const baseTwin = node(0, 0, 0);
    const top = node(1000, 0, 3000);
    // base は upper 階にまたがる（ロック中の）梁から参照されている。
    doc.addMany([a, b, base, baseTwin, top, new Beam(base, top)]);

    expect(planNodeMerge(doc, 1).replacements.size).toBe(0);
    doc.updateLayer(upper, { locked: false });
    expect(planNodeMerge(doc, 1).replacements.size).toBe(2);
  });
});

describe('MergeNodesCommand', () => {
  it('re-points every referencing type and removes beams that became identical', () => {
    const a = node(0, 0);
    const aTwin = node(0, 0);
    const b = node(1000, 0);
    const bTwin = node(1000, 0);
    const c = node(1000, 1000);
    const d = node(0, 1000);
    const first = new Beam(a, b);
    const duplicate = new Beam(aTwin, bTwin);
    const differentSection = new Beam(a, b);
    differentSection.section = 'G9';
    const floor = new Floor([aTwin, bTwin, c, d]);
    const support = new Support(a, ['uz']);
    doc.addMany([a, aTwin, b, bTwin, c, d, first, duplicate, differentSection, floor, support]);

    const plan = doc.execute(new MergeNodesCommand(1));

    // 面材の頂点（aTwin, bTwin）を残し、a, b を付け替える。
    expect([...plan.replacements]).toEqual([
      [a, aTwin],
      [b, bTwin],
    ]);
    expect(plan.redundantElements).toHaveLength(1);
    expect([first, duplicate]).toContain(plan.redundantElements[0]);
    expect(doc.nodeList).toHaveLength(4);
    expect(doc.memberList).toHaveLength(2);
    expect(doc.memberList).toContain(differentSection);
    expect(differentSection.nodeI).toBe(aTwin);
    expect(differentSection.nodeJ).toBe(bTwin);
    expect(floor.nodeList).toEqual([aTwin, bTwin, c, d]);
    expect(support.node).toBe(aTwin);
    // 採番は連番のまま保たれる。
    expect(doc.nodeList.map((item) => item.number)).toEqual([0, 1, 2, 3]);
  });

  it('keeps parallel trusses and supports even when the merge makes them identical', () => {
    const a = node(0, 0);
    const aTwin = node(0, 0);
    const b = node(1000, 0);
    const bTwin = node(1000, 0);
    const trusses = [new Truss(a, b), new Truss(aTwin, bTwin)];
    trusses.forEach((truss) => (truss.area = 100));
    const supports = [new Support(a, ['uz']), new Support(aTwin, ['uz'])];
    doc.addMany([a, aTwin, b, bTwin, ...trusses, ...supports]);

    const plan = doc.execute(new MergeNodesCommand(1));
    expect(plan.replacements.size).toBe(2);
    expect(plan.redundantElements).toEqual([]);
    expect(doc.memberList).toHaveLength(2);
    expect(doc.allDataList.filter((data) => data instanceof Support)).toHaveLength(2);
  });

  it('is a no-op when nothing can be merged', () => {
    const a = node(0, 0);
    const b = node(1000, 0);
    doc.addMany([a, b, new Beam(a, b)]);
    const plan = doc.execute(new MergeNodesCommand(1));
    expect(plan.replacements.size).toBe(0);
    expect(plan.redundantElements).toEqual([]);
    expect(doc.allDataList).toHaveLength(3);
  });
});

describe('orphan nodes', () => {
  it('finds and removes only unreferenced, unlocked nodes', () => {
    const lower = new Layer(0, '1F');
    const upper = new Layer(3000, '2F', { locked: true });
    doc.addLayer(lower);
    doc.addLayer(upper);
    const a = node(0, 0);
    const b = node(1000, 0);
    const orphan = node(500, 500);
    const lockedOrphan = node(0, 0, 3000);
    const supported = node(2000, 0);
    doc.addMany([a, b, orphan, lockedOrphan, supported, new Beam(a, b), new Support(supported, ['uz'])]);

    expect(findOrphanNodes(doc)).toEqual([orphan]);
    expect(doc.execute(new RemoveOrphanNodesCommand())).toEqual([orphan]);
    expect(doc.nodeList).toEqual(expect.arrayContaining([a, b, supported, lockedOrphan]));
    expect(doc.nodeList).toHaveLength(4);
    expect(doc.execute(new RemoveOrphanNodesCommand())).toEqual([]);
  });
});
