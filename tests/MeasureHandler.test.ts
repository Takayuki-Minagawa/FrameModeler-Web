import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../src/data/Document';
import type { DocumentData } from '../src/data/DocumentData';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import type { CadMeasurement, CadView, CadViewMode } from '../src/ui/CadView';
import { MeasureHandler } from '../src/ui/handlers/MeasureHandler';

const doc = Document.instance;
const click = {} as MouseEvent;

interface FakeView {
  view: CadView;
  measurements: Array<CadMeasurement | null>;
  statuses: Array<string | null>;
  lines: Array<[Point3D, Point3D]>;
  points: Point3D[];
  setMode(mode: CadViewMode): void;
  setHit(node: Node | null): void;
}

function fakeView(): FakeView {
  const measurements: Array<CadMeasurement | null> = [];
  const statuses: Array<string | null> = [];
  let lines: Array<[Point3D, Point3D]> = [];
  let points: Point3D[] = [];
  let mode: CadViewMode = 'plan';
  let hit: Node | null = null;
  const view = {
    previewColor: 0xff0000,
    get viewMode() {
      return mode;
    },
    hitTest: (_pos: Point3D, predicate: (data: DocumentData) => boolean) => (hit && predicate(hit) ? hit : null),
    setMeasurement: (measurement: CadMeasurement | null) => measurements.push(measurement),
    setOperationStatus: (status: string | null) => statuses.push(status),
    clearPreview: () => {
      lines = [];
      points = [];
    },
    addPreviewLine: (from: Point3D, to: Point3D) => lines.push([from, to]),
    addPreviewPoint: (point: Point3D) => points.push(point),
    renderPreview: vi.fn(),
  } as unknown as CadView;
  return {
    view,
    measurements,
    statuses,
    get lines() {
      return lines;
    },
    get points() {
      return points;
    },
    setMode: (next) => {
      mode = next;
    },
    setHit: (node) => {
      hit = node;
    },
  };
}

beforeEach(() => doc.init());

describe('MeasureHandler', () => {
  it('measures between two work-plane points and starts over on the third click', () => {
    const fake = fakeView();
    const handler = new MeasureHandler();

    handler.onClick(fake.view, new Point3D(0, 0, 0), click);
    expect(fake.statuses.at(-1)).toBe('firstPointSelected');
    expect(handler.getConstraintAnchor()).toEqual(new Point3D(0, 0, 0));
    expect(fake.points).toHaveLength(1);

    handler.onMouseMove(fake.view, new Point3D(100, 0, 0));
    expect(fake.measurements.at(-1)).toMatchObject({ final: false });
    expect(fake.measurements.at(-1)!.to).toEqual(new Point3D(100, 0, 0));
    expect(fake.lines).toHaveLength(1);

    handler.onClick(fake.view, new Point3D(300, 400, 0), click);
    expect(fake.statuses.at(-1)).toBeNull();
    expect(fake.measurements.at(-1)).toEqual({ from: new Point3D(0, 0, 0), to: new Point3D(300, 400, 0), final: true });
    expect(handler.getConstraintAnchor()).toBeNull();

    // 確定後のマウス移動では結果を上書きせず、確定した線を描き続ける。
    const recorded = fake.measurements.length;
    handler.onMouseMove(fake.view, new Point3D(999, 999, 0));
    expect(fake.measurements).toHaveLength(recorded);
    expect(fake.lines[0][1]).toEqual(new Point3D(300, 400, 0));

    handler.onClick(fake.view, new Point3D(50, 50, 0), click);
    expect(fake.measurements.at(-1)).toBeNull();
    expect(fake.statuses.at(-1)).toBe('firstPointSelected');
    expect(handler.getConstraintAnchor()).toEqual(new Point3D(50, 50, 0));
  });

  it('uses the coordinates of a clicked node so storeys can be spanned', () => {
    const fake = fakeView();
    const handler = new MeasureHandler();
    const base = new Node(new Point3D(0, 0, 0));
    const top = new Node(new Point3D(0, 0, 3000));
    fake.setMode('3d');

    fake.setHit(base);
    handler.onClick(fake.view, new Point3D(5, 5, 0), click);
    fake.setHit(top);
    handler.onClick(fake.view, new Point3D(7, 7, 0), click);

    const result = fake.measurements.at(-1)!;
    expect(result.from).toEqual(base.pos);
    expect(result.to).toEqual(top.pos);
    expect(result.from).not.toBe(base.pos);
  });

  it('only accepts nodes in elevation views and shows no live preview there', () => {
    const fake = fakeView();
    const handler = new MeasureHandler();
    fake.setMode('elevation');

    handler.onClick(fake.view, new Point3D(1, 2, 3), click);
    expect(fake.statuses).toEqual([]);
    expect(handler.getConstraintAnchor()).toBeNull();

    fake.setHit(new Node(new Point3D(0, 0, 0)));
    handler.onClick(fake.view, new Point3D(1, 2, 3), click);
    expect(fake.statuses.at(-1)).toBe('firstPointSelected');

    const recorded = fake.measurements.length;
    handler.onMouseMove(fake.view, new Point3D(10, 10, 10));
    expect(fake.measurements).toHaveLength(recorded);
    expect(fake.lines).toHaveLength(0);
    expect(fake.points).toHaveLength(1);
  });

  it('clears its state when the tool is deactivated and never changes the model', () => {
    const fake = fakeView();
    const handler = new MeasureHandler();
    handler.onClick(fake.view, new Point3D(0, 0, 0), click);
    handler.onDeactivate(fake.view);

    expect(fake.measurements.at(-1)).toBeNull();
    expect(fake.statuses.at(-1)).toBeNull();
    expect(handler.getConstraintAnchor()).toBeNull();
    expect(fake.points).toHaveLength(0);
    expect(doc.allDataList).toHaveLength(0);
  });
});
