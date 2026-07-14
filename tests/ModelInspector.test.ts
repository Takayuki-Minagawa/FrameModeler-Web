import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { inspectModel } from '../src/data/ModelInspector';
import { Node } from '../src/data/Node';
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
});
