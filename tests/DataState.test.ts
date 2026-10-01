import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { BearWall } from '../src/data/BearWall';
import { Constraint } from '../src/data/Constraint';
import { cloneWithNodes } from '../src/data/DataClone';
import { stateValuesEqual } from '../src/data/DataState';
import { Document } from '../src/data/Document';
import type { DocumentData } from '../src/data/DocumentData';
import { Floor, FloorDirection } from '../src/data/Floor';
import { Node } from '../src/data/Node';
import { Pillar } from '../src/data/Pillar';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { TYPE_REGISTRY } from '../src/data/typeRegistry';
import { Wall } from '../src/data/Wall';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

function node(x: number, y: number, z: number): Node {
  return new Node(new Point3D(x, y, z));
}

/** 全登録型を1つずつ持つ、検証を通るモデル。 */
function buildEveryType(): { nodes: Node[]; elements: DocumentData[] } {
  const nodes = [node(0, 0, 0), node(1000, 0, 0), node(1000, 1000, 0), node(0, 1000, 0), node(0, 0, 3000)];
  nodes[0].mass = { values: [1, 2, 3, 4, 5, 6], translationalUnit: 'kg', rotationalUnit: 'kg*mm^2' };
  const [n0, n1, n2, n3, top] = nodes;
  const beam = new Beam(n0, n1);
  beam.section = 'G9';
  beam.isNodeReverse = true;
  const pillar = new Pillar(n0, top);
  const truss = new Truss(n0, n2);
  truss.material = 'SN400';
  truss.area = 1200;
  truss.elasticModulus = 205000;
  const spring = new Spring(n0, n3);
  spring.components = [{ dof: 'ux', stiffness: 10, unit: 'N/mm' }];
  spring.orientX = new Point3D(1, 0, 0);
  spring.orientY = new Point3D(0, 1, 0);
  spring.shearDistance = [0.25, 0.75];
  spring.note = 'damper';
  const floor = new Floor([n0, n1, n2, n3]);
  floor.weight = 5;
  floor.direction = FloorDirection.Y;
  const wall = new Wall([n0, n1, n2, n3]);
  wall.weight = 7;
  const bearWall = new BearWall([n0, n1, n2, n3]);
  const support = new Support(n0, ['ux', 'uz']);
  const constraint = new Constraint(n1, 'uy', [{ node: n0, dof: 'uy', coefficient: 1 }]);
  return { nodes, elements: [beam, pillar, truss, spring, bearWall, wall, floor, support, constraint] };
}

describe('stateValuesEqual', () => {
  it('compares points, arrays and plain objects by content and class instances by identity', () => {
    const shared = node(0, 0, 0);
    expect(stateValuesEqual({ p: new Point3D(1, 2, 3) }, { p: new Point3D(1, 2, 3) })).toBe(true);
    expect(stateValuesEqual({ p: new Point3D(1, 2, 3) }, { p: new Point3D(1, 2, 4) })).toBe(false);
    expect(stateValuesEqual([{ a: 1 }, [2, 3]], [{ a: 1 }, [2, 3]])).toBe(true);
    expect(stateValuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(stateValuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(stateValuesEqual({ node: shared }, { node: shared })).toBe(true);
    expect(stateValuesEqual({ node: shared }, { node: node(0, 0, 0) })).toBe(false);
    expect(stateValuesEqual(null, null)).toBe(true);
    expect(stateValuesEqual(null, {})).toBe(false);
  });
});

describe('DocumentData state API', () => {
  it('covers every registered model type', () => {
    const { nodes, elements } = buildEveryType();
    const kinds = new Set([...nodes, ...elements].map((data) => data.kind));
    expect([...kinds].sort()).toEqual(TYPE_REGISTRY.map((entry) => entry.kind).sort());
  });

  it('captures an independent copy and restores every mutable field', () => {
    const { nodes, elements } = buildEveryType();
    for (const data of [...nodes, ...elements]) {
      const state = data.captureState();
      expect(stateValuesEqual(data.captureState(), state), data.kind).toBe(true);

      const copy = cloneWithNodes(data, new Map(nodes.map((item) => [item, item] as const)));
      if (data instanceof Node) continue;
      // 複製は別インスタンスだが、参照Nodeを同一に保てば状態は等価になる。
      expect(copy, data.kind).not.toBe(data);
      expect(stateValuesEqual(copy.captureState(), state), data.kind).toBe(true);
    }

    const [n0] = nodes;
    const before = n0.captureState();
    n0.pos.x = 99;
    n0.mass!.values[0] = 99;
    expect(stateValuesEqual(n0.captureState(), before)).toBe(false);
    n0.restoreState(before);
    expect(n0.pos.x).toBe(0);
    expect(n0.mass!.values[0]).toBe(1);
    // 復元後に再度変更しても、保存済みstateは汚染されない。
    n0.pos.x = 5;
    n0.restoreState(before);
    expect(n0.pos.x).toBe(0);
  });

  it('rolls back type-specific fields when a transaction fails', () => {
    const { nodes, elements } = buildEveryType();
    doc.addMany([...nodes, ...elements]);
    const snapshots = new Map(doc.allDataList.map((data) => [data, data.captureState()] as const));
    const spring = doc.allDataList.find((data): data is Spring => data instanceof Spring)!;
    const floor = doc.allDataList.find((data): data is Floor => data instanceof Floor)!;
    const support = doc.allDataList.find((data): data is Support => data instanceof Support)!;
    const constraint = doc.allDataList.find((data): data is Constraint => data instanceof Constraint)!;
    const truss = doc.allDataList.find((data): data is Truss => data instanceof Truss)!;

    expect(() =>
      doc.transaction(() => {
        spring.components[0].stiffness = 999;
        spring.orientX!.x = 0.5;
        spring.shearDistance![0] = 0.9;
        floor.weight = 123;
        floor.direction = FloorDirection.XY;
        support.fixedDofs.push('rz');
        constraint.terms[0].coefficient = 4;
        truss.area = 1;
        throw new Error('abort');
      }),
    ).toThrow('abort');

    for (const [data, state] of snapshots) {
      expect(stateValuesEqual(data.captureState(), state), data.kind).toBe(true);
    }
  });

  it('exposes referenced nodes and remaps them for every referencing type', () => {
    const { nodes, elements } = buildEveryType();
    const replacement = node(5, 5, 5);
    const map = new Map([[nodes[0], replacement]]);
    for (const element of elements) {
      expect(element.referencedNodes.length, element.kind).toBeGreaterThan(0);
      expect(element.isReferring(nodes[0]), element.kind).toBe(true);
      element.remapNodes(map);
      expect(element.isReferring(nodes[0]), element.kind).toBe(false);
      expect(element.isReferring(replacement), element.kind).toBe(true);
    }
    expect(nodes[0].referencedNodes).toEqual([]);
    expect(nodes[0].isReferring(nodes[1])).toBe(false);
  });
});

describe('cloneWithNodes', () => {
  it('returns the mapped node instead of resetting an existing node', () => {
    const source = node(0, 0, 0);
    const existing = node(0, 0, 3000);
    existing.number = 7;
    existing.select = true;
    const result = cloneWithNodes(source, new Map([[source, existing]]));
    expect(result).toBe(existing);
    expect(existing.number).toBe(7);
    expect(existing.select).toBe(true);
  });

  it('rejects elements whose referenced nodes are not mapped', () => {
    const a = node(0, 0, 0);
    const b = node(1, 0, 0);
    expect(() => cloneWithNodes(new Beam(a, b), new Map([[a, a]]))).toThrow(/nodeMap has no entry/);
  });
});

describe('Document typed list cache', () => {
  it('reflects additions, removals, rollback and reload without stale entries', () => {
    const a = node(0, 0, 0);
    const b = node(1000, 0, 0);
    const beam = new Beam(a, b);
    doc.addMany([a, b, beam]);
    const firstRead = doc.nodeList;
    expect(doc.nodeList).toBe(firstRead);
    expect(doc.memberList).toEqual([beam]);

    const c = node(2000, 0, 0);
    doc.add(c);
    expect(doc.nodeList).toHaveLength(3);
    expect(doc.nodeList).not.toBe(firstRead);

    expect(() =>
      doc.transaction(() => {
        doc.add(node(3000, 0, 0));
        expect(doc.nodeList).toHaveLength(4);
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(doc.nodeList).toHaveLength(3);

    doc.removeMany([beam, a, b]);
    expect(doc.memberList).toEqual([]);
    expect(doc.nodeList).toEqual([c]);

    const copy = doc.chooseData(Node);
    copy.length = 0;
    expect(doc.nodeList).toEqual([c]);

    doc.init();
    expect(doc.nodeList).toEqual([]);
    expect(doc.planeList).toEqual([]);
  });

  it('rejects removal of nodes still referenced outside the removal set', () => {
    const a = node(0, 0, 0);
    const b = node(1000, 0, 0);
    const beam = new Beam(a, b);
    const support = new Support(a, ['uz']);
    doc.addMany([a, b, beam, support]);
    expect(() => doc.removeMany([a, beam])).toThrow(/参照されているノード/);
    expect(doc.allDataList).toHaveLength(4);
    doc.removeMany([a, beam, support]);
    expect(doc.allDataList).toEqual([b]);
  });
});
