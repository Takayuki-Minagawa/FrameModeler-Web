import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { BearWall } from '../src/data/BearWall';
import { Constraint } from '../src/data/Constraint';
import { Document } from '../src/data/Document';
import { DocumentData } from '../src/data/DocumentData';
import { Floor } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { ModelValidator } from '../src/data/ModelValidator';
import { Node } from '../src/data/Node';
import { Pillar } from '../src/data/Pillar';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { TYPE_REGISTRY } from '../src/data/typeRegistry';
import { Wall } from '../src/data/Wall';
import { cloneWithNodes, DOCUMENT_DATA_CODECS, serializeDocumentData } from '../src/io/DocumentDataCodecRegistry';
import { deserializeJson } from '../src/io/JsonDeserializer';
import { serializeJson } from '../src/io/JsonSerializer';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

function node(x: number, y: number, z: number): Node {
  return new Node(new Point3D(x, y, z));
}

describe('structural data models and centralized JSON codecs', () => {
  beforeEach(() => doc.init());

  it('keeps every core model type aligned with exactly one codec in core order', () => {
    expect(DOCUMENT_DATA_CODECS.map(({ kind, ctor, category }) => ({ kind, ctor, category }))).toEqual(
      TYPE_REGISTRY.map(({ kind, ctor, category }) => ({ kind, ctor, category })),
    );
    expect(new Set(DOCUMENT_DATA_CODECS.map((entry) => entry.kind)).size).toBe(TYPE_REGISTRY.length);
  });

  it('round-trips mass, truss, zero-length spring, support, and six-DOF constraint data', () => {
    const n0 = node(0, 0, 0);
    const n1 = node(0, 0, 0);
    const n2 = node(1000, 0, 0);
    n0.mass = {
      values: [1, 2, 3, 4, 5, 6],
      translationalUnit: 'N*s^2/mm',
      rotationalUnit: 'N*mm*s^2',
    };

    const truss = new Truss(n0, n2);
    truss.section = 'BRACE';
    truss.material = 'steel';
    truss.area = 225;
    truss.areaUnit = 'mm^2';
    truss.elasticModulus = 205000;
    truss.stressUnit = 'N/mm^2';
    truss.isNodeReverse = true;

    const spring = new Spring(n0, n1);
    spring.components = [
      { dof: 'uz', stiffness: 1200, unit: 'N/mm' },
      { dof: 'ry', stiffness: 3400, unit: 'N*mm/rad' },
    ];
    spring.orientX = new Point3D(1, 0, 0);
    spring.orientY = new Point3D(0, 0, 1);
    spring.shearDistance = [0.25, 0.75];
    spring.note = 'zero-length connection';

    const support = new Support(n0, ['ux', 'uy', 'uz', 'rx', 'ry', 'rz']);
    const constraint = new Constraint(n1, 'ux', [{ node: n0, dof: 'ux', coefficient: 1 }]);
    doc.bulkLoad(
      [n0, n1, n2, truss, spring, support, constraint],
      [new Layer(0, 'Base', { id: 'base', visible: true, locked: false })],
    );

    const encoded = JSON.parse(serializeJson());
    expect(encoded.schemaVersion).toBe(2);
    expect(encoded.nodes.find((row: any) => row.mass)?.mass).toEqual(n0.mass);
    expect(encoded.trusses).toHaveLength(1);
    expect(encoded.springs).toHaveLength(1);
    expect(encoded.supports).toHaveLength(1);
    expect(encoded.constraints).toHaveLength(1);
    expect(encoded.springs[0].nodeI).not.toBe(encoded.springs[0].nodeJ);

    doc.init();
    deserializeJson(JSON.stringify(encoded));

    const importedTruss = doc.allDataList.find((data): data is Truss => data.kind === 'truss');
    const importedSpring = doc.allDataList.find((data): data is Spring => data.kind === 'spring');
    const importedSupport = doc.allDataList.find((data): data is Support => data.kind === 'support');
    const importedConstraint = doc.allDataList.find((data): data is Constraint => data.kind === 'constraint');
    expect(doc.nodeList.find((item) => item.mass)?.mass).toEqual(n0.mass);
    expect(importedTruss).toMatchObject({
      section: 'BRACE',
      material: 'steel',
      area: 225,
      areaUnit: 'mm^2',
      elasticModulus: 205000,
      stressUnit: 'N/mm^2',
      isNodeReverse: true,
    });
    expect(importedSpring?.nodeI).not.toBe(importedSpring?.nodeJ);
    expect(importedSpring?.posI.sub(importedSpring.posJ).length).toBe(0);
    expect(importedSpring?.components).toEqual(spring.components);
    expect(importedSpring?.orientX).toEqual(spring.orientX);
    expect(importedSpring?.orientY).toEqual(spring.orientY);
    expect(importedSpring?.shearDistance).toEqual([0.25, 0.75]);
    expect(importedSpring?.note).toBe('zero-length connection');
    expect(importedSupport?.node).toBeInstanceOf(Node);
    expect(importedSupport?.fixedDofs).toEqual(['ux', 'uy', 'uz', 'rx', 'ry', 'rz']);
    expect(importedConstraint?.slaveNode).toBeInstanceOf(Node);
    expect(importedConstraint?.slaveDof).toBe('ux');
    expect(importedConstraint?.terms).toHaveLength(1);
    expect(importedConstraint?.terms[0].node).toBeInstanceOf(Node);
    expect(importedConstraint?.terms[0]).toMatchObject({ dof: 'ux', coefficient: 1 });
  });

  it('allows zero geometric length only for a Spring with distinct Node objects', () => {
    const first = node(0, 0, 0);
    const coincident = node(0, 0, 0);
    const spring = new Spring(first, coincident);
    spring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }];

    expect(() =>
      ModelValidator.validateModel([first, coincident, spring], [], { validateNumbers: false }),
    ).not.toThrow();
    expect(() =>
      ModelValidator.validateModel([first, coincident, new Beam(first, coincident)], [], { validateNumbers: false }),
    ).toThrow(/member length/);
    const truss = new Truss(first, coincident);
    truss.area = 1;
    expect(() => ModelValidator.validateModel([first, coincident, truss], [], { validateNumbers: false })).toThrow(
      /member length/,
    );
    const sameNodeSpring = new Spring(first, first);
    sameNodeSpring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }];
    expect(() => ModelValidator.validateModel([first, sameNodeSpring], [], { validateNumbers: false })).toThrow(
      /endpoints must be different/,
    );
  });

  it('migrates v1 to v2 and preserves unknown optional layer fields', () => {
    deserializeJson(
      JSON.stringify({
        schemaVersion: 1,
        nodes: [{ number: 0, pos: { x: 0, y: 0, z: 0 }, select: true }],
        layers: [
          {
            id: 'legacy-layer',
            name: 'Legacy',
            posZ: 0,
            visible: false,
            locked: true,
            analysisGroup: { name: 'A', color: '#123456' },
          },
          { name: 'Legacy defaults', posZ: 1000 },
        ],
      }),
    );

    const output = JSON.parse(serializeJson());
    expect(output.schemaVersion).toBe(2);
    expect(output.nodes[0].select).toBeUndefined();
    expect(output.trusses).toEqual([]);
    expect(output.springs).toEqual([]);
    expect(output.supports).toEqual([]);
    expect(output.constraints).toEqual([]);
    expect(output.layers[0]).toMatchObject({
      id: 'legacy-layer',
      name: 'Legacy',
      posZ: 0,
      visible: false,
      locked: true,
      analysisGroup: { name: 'A', color: '#123456' },
    });
    expect(output.layers[1]).toMatchObject({ name: 'Legacy defaults', posZ: 1000, visible: true, locked: false });
    expect(output.layers[1].id).toMatch(/^layer-/);
  });

  it('clones every registered model type through the codec registry without copying selection state', () => {
    const originals = [node(0, 0, 0), node(1000, 0, 0), node(1000, 1000, 0), node(0, 1000, 0)];
    originals[0].mass = {
      values: [1, 0, 0, 0, 0, 0],
      translationalUnit: 'kg',
      rotationalUnit: 'kg*mm^2',
    };
    const [n0, n1, n2, n3] = originals;
    const beam = new Beam(n0, n1);
    const pillar = new Pillar(n0, n1);
    const truss = new Truss(n0, n2);
    truss.area = 1;
    const spring = new Spring(n0, n1);
    spring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }];
    const floor = new Floor([n0, n1, n2, n3]);
    const wall = new Wall([n0, n1, n2, n3]);
    const bearWall = new BearWall([n0, n1, n2, n3]);
    const support = new Support(n0, ['uz']);
    const constraint = new Constraint(n1, 'uy', [{ node: n0, dof: 'uy', coefficient: 1 }]);
    const data = [...originals, beam, pillar, truss, spring, bearWall, wall, floor, support, constraint];
    data.forEach((item, index) => {
      item.number = index + 10;
      item.select = true;
    });

    const nodeMap = new Map<Node, Node>();
    const clonedNodes = originals.map((item) => cloneWithNodes(item, nodeMap));
    const clones = [...clonedNodes, ...data.slice(originals.length).map((item) => cloneWithNodes(item, nodeMap))];

    expect(clones.map((item) => item.kind)).toEqual(data.map((item) => item.kind));
    expect(clones.every((item) => item.number === 0 && item.select === false)).toBe(true);
    expect(clonedNodes[0].mass).toEqual(originals[0].mass);
    expect(clonedNodes[0].mass).not.toBe(originals[0].mass);
    expect(() => ModelValidator.validateModel(clones, [], { validateNumbers: false })).not.toThrow();
  });

  it('rejects unregistered DocumentData at the centralized serialization boundary', () => {
    class ShadowBeam extends DocumentData {
      readonly kind = 'beam' as const;
      get typeText(): string {
        return 'shadow';
      }
    }

    expect(() => serializeDocumentData([new ShadowBeam()])).toThrow(/unsupported DocumentData kind 'beam'/);
  });

  it('throws for Member endpoint indexes other than 0 and 1', () => {
    const first = node(0, 0, 0);
    const second = node(1, 0, 0);
    const beam = new Beam(first, second);

    expect(beam.getNode(0)).toBe(first);
    expect(beam.getNode(1)).toBe(second);
    expect(() => beam.getNode(-1)).toThrow(RangeError);
    expect(() => beam.getNode(2)).toThrow(RangeError);
    expect(() => beam.setNode(-1, second)).toThrow(RangeError);
    expect(() => beam.setNode(2, second)).toThrow(RangeError);
  });
});
