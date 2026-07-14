import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { inspectModel } from '../src/data/ModelInspector';
import { collectModelErrors, ModelValidator } from '../src/data/ModelValidator';
import { Node } from '../src/data/Node';
import { Spring } from '../src/data/Spring';
import { Point3D } from '../src/math/Point3D';
import { Layer } from '../src/ui/Layer';

describe('inspectModel', () => {
  beforeEach(() => Document.instance.init());

  it('reports orphan and duplicate-coordinate nodes without mutating the model', () => {
    const first = new Node(new Point3D(0, 0, 0));
    const second = new Node(new Point3D(0, 0, 0));
    Document.instance.addMany([first, second]);

    const before = [...Document.instance.allDataList];
    const codes = inspectModel(Document.instance).map((issue) => issue.code);

    expect(codes).toContain('ORPHAN_NODE');
    expect(codes).toContain('DUPLICATE_NODE_COORDINATE');
    expect(Document.instance.allDataList).toEqual(before);
  });

  it('reports duplicate members and beams across layer elevations', () => {
    const lower = new Node(new Point3D(0, 0, 0));
    const upper = new Node(new Point3D(1000, 0, 3000));
    const first = new Beam(lower, upper);
    const second = new Beam(lower, upper);
    Document.instance.bulkLoad([lower, upper, first, second], [new Layer(0, '1F'), new Layer(3000, '2F')]);

    const issues = inspectModel(Document.instance);
    expect(issues.some((issue) => issue.code === 'DUPLICATE_MEMBER')).toBe(true);
    expect(issues.some((issue) => issue.code === 'CROSS_LEVEL_BEAM')).toBe(true);
  });

  it('reports independent invariant violations as separate targeted issues', () => {
    const n0 = new Node(new Point3D(0, 0, 0));
    const n1 = new Node(new Point3D(1000, 0, 0));
    const n2 = new Node(new Point3D(2000, 0, 0));
    const beam = new Beam(n0, n1);
    const spring = new Spring(n1, n2);
    spring.components = [{ dof: 'ux', stiffness: 1, unit: 'N/mm' }];
    Document.instance.bulkLoad([n0, n1, n2, beam, spring], []);

    n0.mass = {
      values: [-1, 0, 0, 0, 0, 0],
      translationalUnit: 'kg',
      rotationalUnit: 'kg*mm^2',
    };
    beam.nodeJ = beam.nodeI;
    spring.components[0].stiffness = 0;

    const errors = inspectModel(Document.instance).filter((issue) => issue.code === 'MODEL_INVALID');
    expect(errors).toHaveLength(3);
    expect(errors.map((issue) => issue.targets[0])).toEqual(expect.arrayContaining([n0, beam, spring]));
    expect(errors.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^nodes\[/), expect.stringMatching(/^data\[/)]),
    );
  });

  it('suppresses validation duplicates caused by the same repeated object', () => {
    const repeated = new Node(new Point3D(0, 0, 0));
    const errors = collectModelErrors([repeated, repeated], [], { validateNumbers: false });

    expect(errors.filter((error) => error.message.includes('same object'))).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('validates stable layer ids and interaction flags in fail-fast and collection modes', () => {
    const first = new Layer(0, '1F', { id: 'same-layer' });
    const second = new Layer(3000, '2F', { id: 'same-layer' });

    expect(() => ModelValidator.validateLayers([first, second])).toThrow(/duplicate layer id/);
    expect(() => ModelValidator.validateLayers([new Layer(6000, '3F', { id: '' })])).toThrow(/id.*non-empty/);

    (second as unknown as { visible: unknown }).visible = 'yes';
    (first as unknown as { locked: unknown }).locked = 1;
    const paths = collectModelErrors([], [first, second]).map((error) => error.path);
    expect(paths).toEqual(expect.arrayContaining(['layers[0].locked', 'layers[1].id', 'layers[1].visible']));
  });
});
