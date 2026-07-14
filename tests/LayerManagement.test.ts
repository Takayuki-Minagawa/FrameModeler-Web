import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Constraint } from '../src/data/Constraint';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { copyLayerContents } from '../src/data/LayerCopy';
import { Node } from '../src/data/Node';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

describe('Layer identity and display state', () => {
  it('preserves a stable ID for snapshots but generates a fresh ID for duplication', () => {
    const source = new Layer(0, '1F', { id: 'layer-1f', visible: false, locked: true });
    const snapshotClone = source.clone();
    const duplicate = source.clone({ preserveId: false });

    expect(snapshotClone).not.toBe(source);
    expect(snapshotClone).toMatchObject({ id: 'layer-1f', visible: false, locked: true });
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate).toMatchObject({ visible: false, locked: true });
  });

  it('rejects duplicate IDs independently from elevation and supports isolate/show-all', () => {
    const lower = new Layer(0, '1F', { id: 'layer-floor' });
    const upper = new Layer(3000, '2F', { id: 'layer-upper', visible: false, locked: true });
    expect(doc.addLayer(lower)).toBe(true);
    expect(doc.addLayer(new Layer(6000, 'RF', { id: 'layer-floor' }))).toBe(false);
    expect(doc.addLayer(upper)).toBe(true);

    expect(doc.isolateLayer(lower)).toBe(true);
    expect(doc.shownLayer).toBe(lower);
    expect(doc.layers.map((layer) => layer.visible)).toEqual([true, false]);
    expect(doc.isolateLayer(upper)).toBe(true);
    expect(doc.shownLayer).toBe(upper);
    expect(doc.layers.map((layer) => layer.visible)).toEqual([false, true]);
    doc.showAllLayers();
    expect(doc.layers.map((layer) => layer.visible)).toEqual([true, true]);
    expect(upper.locked).toBe(true);
    expect(doc.isolateLayer(new Layer(9000, 'outside'))).toBe(false);
    expect(doc.removeLayer(upper)).toBe(false);
    expect(doc.layers).toContain(upper);
    doc.updateLayer(upper, { locked: false });
    expect(doc.removeLayer(upper)).toBe(true);
    expect(doc.layers).not.toContain(upper);
  });

  it('derives element visibility and locking from every layer it occupies', () => {
    const lower = new Layer(0, '1F', { id: 'layer-lower', visible: true });
    const upper = new Layer(3000, '2F', { id: 'layer-upper', visible: false, locked: true });
    doc.addLayer(lower);
    doc.addLayer(upper);
    const bottom = new Node(new Point3D(0, 0, 0));
    const top = new Node(new Point3D(0, 0, 3000));
    const beam = new Beam(bottom, top);
    doc.addMany([bottom, top, beam]);

    expect(doc.isDataVisible(bottom)).toBe(true);
    expect(doc.isDataVisible(top)).toBe(false);
    expect(doc.isDataVisible(beam)).toBe(true);
    expect(doc.isDataLocked(bottom)).toBe(false);
    expect(doc.isDataLocked(top)).toBe(true);
    expect(doc.isDataLocked(beam)).toBe(true);

    doc.updateLayer(lower, { visible: false });
    expect(doc.isDataVisible(beam)).toBe(false);
  });

  it('supports independent layer-view subscribers and rejects foreign shown layers', () => {
    const lower = new Layer(0, '1F', { id: 'layer-subscribe-lower' });
    const upper = new Layer(3000, '2F', { id: 'layer-subscribe-upper' });
    doc.addLayer(lower);
    doc.addLayer(upper);
    const changes: string[] = [];
    const unsubscribe = doc.subscribeLayerView((document) => changes.push(document.shownLayer?.id ?? 'none'));

    doc.shownLayer = lower;
    doc.shownLayer = upper;
    expect(changes).toEqual(['layer-subscribe-lower', 'layer-subscribe-upper']);
    expect(() => (doc.shownLayer = new Layer(6000, 'foreign'))).toThrow(/belong/);

    unsubscribe();
    doc.shownLayer = lower;
    expect(changes).toHaveLength(2);
  });
});

describe('copyLayerContents', () => {
  it('refuses to write into a locked target layer', () => {
    const source = new Layer(0, '1F', { id: 'layer-source' });
    const target = new Layer(3000, '2F', { id: 'layer-target', locked: true });
    doc.addLayer(source);
    doc.addLayer(target);
    doc.add(new Node(new Point3D(0, 0, 0)));

    expect(() => copyLayerContents(source, target, doc)).toThrow(/locked layer/);
    expect(doc.nodeList).toHaveLength(1);
  });

  it('copies all registered in-plane structural data with properties and avoids duplicates', () => {
    const source = new Layer(0, '1F', { id: 'layer-source' });
    const target = new Layer(3000, '2F', { id: 'layer-target' });
    doc.addLayer(source);
    doc.addLayer(target);

    const nodes = [
      new Node(new Point3D(0, 0, 0)),
      new Node(new Point3D(1000, 0, 0)),
      new Node(new Point3D(1000, 1000, 0)),
      new Node(new Point3D(0, 1000, 0)),
    ];
    nodes[0].mass = {
      values: [1, 2, 3, 4, 5, 6],
      translationalUnit: 'kg',
      rotationalUnit: 'kg*m^2',
    };
    const beam = new Beam(nodes[0], nodes[1]);
    beam.section = 'H-400x200';
    const truss = new Truss(nodes[1], nodes[2]);
    truss.material = 'SN400';
    truss.area = 1200;
    truss.elasticModulus = 205000;
    const spring = new Spring(nodes[2], nodes[3]);
    spring.components = [{ dof: 'ux', stiffness: 2500, unit: 'N/mm' }];
    spring.note = 'story damper';
    const floor = new Floor(nodes);
    floor.section = 'S150';
    floor.weight = 3.5;
    const support = new Support(nodes[0], ['ux', 'uy', 'uz']);
    const constraint = new Constraint(nodes[3], 'ux', [{ node: nodes[0], dof: 'ux', coefficient: 1 }]);
    doc.addMany([...nodes, beam, truss, spring, floor, support, constraint]);

    copyLayerContents(source, target, doc);

    const targetNodes = doc.nodeList.filter((node) => node.pos.z === target.posZ);
    expect(targetNodes).toHaveLength(4);
    expect(targetNodes.find((node) => node.pos.x === 0 && node.pos.y === 0)?.mass).toEqual(nodes[0].mass);
    expect(doc.chooseData(Beam)).toHaveLength(2);
    expect(doc.chooseData(Beam).find((item) => item.nodeI?.pos.z === target.posZ)?.section).toBe('H-400x200');
    expect(doc.chooseData(Truss)).toHaveLength(2);
    expect(doc.chooseData(Truss).find((item) => item.nodeI?.pos.z === target.posZ)).toMatchObject({
      material: 'SN400',
      area: 1200,
      elasticModulus: 205000,
    });
    expect(doc.chooseData(Spring)).toHaveLength(2);
    expect(doc.chooseData(Spring).find((item) => item.nodeI?.pos.z === target.posZ)).toMatchObject({
      components: [{ dof: 'ux', stiffness: 2500, unit: 'N/mm' }],
      note: 'story damper',
    });
    expect(doc.chooseData(Floor)).toHaveLength(2);
    expect(
      doc.chooseData(Floor).find((item) => item.nodeList.every((node) => node.pos.z === target.posZ)),
    ).toMatchObject({
      section: 'S150',
      weight: 3.5,
    });
    expect(doc.chooseData(Support)).toHaveLength(2);
    expect(doc.chooseData(Support).find((item) => item.node?.pos.z === target.posZ)?.fixedDofs).toEqual([
      'ux',
      'uy',
      'uz',
    ]);
    expect(doc.chooseData(Constraint)).toHaveLength(2);
    const copiedConstraint = doc.chooseData(Constraint).find((item) => item.slaveNode?.pos.z === target.posZ);
    expect(copiedConstraint?.slaveDof).toBe('ux');
    expect(copiedConstraint?.terms).toHaveLength(1);
    expect(copiedConstraint?.terms[0]).toMatchObject({ dof: 'ux', coefficient: 1 });
    expect(copiedConstraint?.terms[0].node.pos.z).toBe(target.posZ);

    const countAfterFirstCopy = doc.allDataList.length;
    copyLayerContents(source, target, doc);
    expect(doc.allDataList).toHaveLength(countAfterFirstCopy);
  });

  it('preserves coincident node topology when copying a zero-length Spring', () => {
    const source = new Layer(0, '1F', { id: 'layer-zero-source' });
    const target = new Layer(3000, '2F', { id: 'layer-zero-target' });
    doc.addLayer(source);
    doc.addLayer(target);
    const first = new Node(new Point3D(100, 200, 0));
    const second = new Node(new Point3D(100, 200, 0));
    const spring = new Spring(first, second);
    spring.components = [{ dof: 'ux', stiffness: 500, unit: 'N/mm' }];
    doc.addMany([first, second, spring]);

    copyLayerContents(source, target, doc);

    const targetNodes = doc.nodeList.filter((node) => node.pos.x === 100 && node.pos.y === 200 && node.pos.z === 3000);
    expect(targetNodes).toHaveLength(2);
    const copied = doc.chooseData(Spring).find((item) => item.nodeI?.pos.z === 3000);
    expect(copied?.nodeI).not.toBe(copied?.nodeJ);
    expect(copied?.posI.sub(copied.posJ).length).toBe(0);

    const count = doc.allDataList.length;
    copyLayerContents(source, target, doc);
    expect(doc.allDataList).toHaveLength(count);
  });

  it('does not treat parallel members with different structural properties as duplicates', () => {
    const source = new Layer(0, '1F', { id: 'layer-parallel-source' });
    const target = new Layer(3000, '2F', { id: 'layer-parallel-target' });
    doc.addLayer(source);
    doc.addLayer(target);
    const first = new Node(new Point3D(0, 0, 0));
    const second = new Node(new Point3D(1000, 0, 0));
    const soft = new Spring(first, second);
    soft.components = [{ dof: 'ux', stiffness: 100, unit: 'N/mm' }];
    const stiff = new Spring(first, second);
    stiff.components = [{ dof: 'ux', stiffness: 200, unit: 'N/mm' }];
    doc.addMany([first, second, soft, stiff]);

    copyLayerContents(source, target, doc);

    expect(
      doc
        .chooseData(Spring)
        .filter((spring) => spring.nodeI?.pos.z === 3000)
        .map((spring) => spring.components[0].stiffness),
    ).toEqual([100, 200]);
  });
});
