import { beforeEach, describe, expect, it } from 'vitest';
import { MergeNodesCommand, RemoveOrphanNodesCommand } from '../src/commands/DocumentCommands';
import { Beam } from '../src/data/Beam';
import { Constraint } from '../src/data/Constraint';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { findOrphanNodes, planNodeMerge } from '../src/data/NodeMerge';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
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

  it('never merges nodes that the same element references', () => {
    const a = node(0, 0);
    const b = node(0, 0);
    const spring = new Spring(a, b);
    spring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }];
    const c = node(0, 0);
    const constraint = new Constraint(c, 'ux', [{ node: a, dof: 'ux', coefficient: 1 }]);
    doc.addMany([a, b, c, spring, constraint]);

    const plan = planNodeMerge(doc, 1);
    // a-b はばね、a-c は拘束で結ばれている。b と c は共有要素が無いので結合できる。
    expect(plan.replacements.has(a)).toBe(false);
    const merged = [...plan.replacements];
    expect(merged).toHaveLength(1);
    expect(new Set([merged[0][0], merged[0][1]])).toEqual(new Set([b, c]));

    doc.execute(new MergeNodesCommand(1));
    expect(doc.nodeList).toHaveLength(2);
    expect(spring.nodeI).not.toBe(spring.nodeJ);
    expect(constraint.slaveNode).not.toBe(constraint.terms[0].node);
  });

  it('does not chain a merge that would collapse an element through a third node', () => {
    // a - b は 0.8 離れた梁の両端。m はその中間にあり、どちらとも許容差以内。
    const a = node(0, 0);
    const m = node(0.4, 0);
    const b = node(0.8, 0);
    doc.addMany([a, m, b, new Beam(a, b)]);

    doc.execute(new MergeNodesCommand(0.5));
    expect(doc.nodeList).toHaveLength(2);
    expect(doc.memberList[0].nodeI).not.toBe(doc.memberList[0].nodeJ);
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
  it('re-points every referencing type and removes elements that became identical', () => {
    const a = node(0, 0);
    const aTwin = node(0, 0);
    const b = node(1000, 0);
    const bTwin = node(1000, 0);
    const c = node(1000, 1000);
    const d = node(0, 1000);
    const first = new Beam(a, b);
    const duplicate = new Beam(aTwin, bTwin);
    const differentSection = new Beam(aTwin, bTwin);
    differentSection.section = 'G9';
    const floor = new Floor([aTwin, bTwin, c, d]);
    const support = new Support(aTwin, ['uz']);
    doc.addMany([a, aTwin, b, bTwin, c, d, first, duplicate, differentSection, floor, support]);

    const plan = doc.execute(new MergeNodesCommand(1));

    expect(plan.replacements.size).toBe(2);
    expect(plan.redundantElements).toEqual([duplicate]);
    expect(doc.nodeList).toHaveLength(4);
    expect(doc.memberList).toEqual(expect.arrayContaining([first, differentSection]));
    expect(doc.memberList).toHaveLength(2);
    expect(differentSection.nodeI).toBe(a);
    expect(differentSection.nodeJ).toBe(b);
    expect(floor.nodeList).toEqual([a, b, c, d]);
    expect(support.node).toBe(a);
    // 採番は連番のまま保たれる。
    expect(doc.nodeList.map((item) => item.number)).toEqual([0, 1, 2, 3]);
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
