import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { copyLayerContents } from '../src/data/LayerCopy';
import { ModelValidationError } from '../src/data/ModelValidator';
import { Node } from '../src/data/Node';
import { findNodesOrphanedBy } from '../src/data/NodeMerge';
import { Pillar } from '../src/data/Pillar';
import { Wall } from '../src/data/Wall';
import { setLocale } from '../src/i18n';
import { parseJsonDocument } from '../src/io/JsonSchema';
import { pointFromDistanceAndAngle } from '../src/math/PlanInput';
import { Point3D } from '../src/math/Point3D';
import { roundCoordinate, roundToStep } from '../src/math/round';
import { describeModelError } from '../src/ui/ModelErrorMessage';
import { rotateDraftIdentity } from '../src/history/DraftStore';
import { ModelValidator } from '../src/data/ModelValidator';

const doc = Document.instance;

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

beforeEach(() => {
  doc.init();
  setLocale('ja');
});

describe('coordinate rounding', () => {
  it('drops trigonometric noise from distance/angle input', () => {
    const result = pointFromDistanceAndAngle({ anchor: Point3D.Zero, distance: 2000, angleDegrees: 90 });
    expect(result.position).toEqual(new Point3D(0, 2000, 0));
    expect(pointFromDistanceAndAngle({ anchor: Point3D.Zero, distance: 1000, angleDegrees: 180 }).position).toEqual(
      new Point3D(-1000, 0, 0),
    );
  });

  it('rounds helpers normalise -0 and ignore invalid steps', () => {
    expect(roundCoordinate(-1.2e-13)).toBe(0);
    expect(Object.is(roundCoordinate(-1e-9), -0)).toBe(false);
    expect(roundToStep(836.6013071895424, 10)).toBe(840);
    expect(roundToStep(836.6, 0)).toBe(836.6);
    expect(roundToStep(Number.NaN, 10)).toBeNaN();
  });

  it('rounds the projection onto a member above so wall nodes get clean coordinates', () => {
    const a = node(0, 0, 3500);
    const b = node(6000, 0, 3500);
    doc.addMany([a, b, new Beam(a, b)]);
    expect(doc.getPosAbove(new Point3D(840, 0, 0))).toEqual(new Point3D(840, 0, 3500));
  });
});

describe('position above with layer fallback', () => {
  it('uses the next layer elevation when nothing exists above, picking the closest candidate', () => {
    doc.addLayer(new Layer(0, '1F'));
    expect(doc.getPosAbove(new Point3D(100, 200, 0))).toBeNull();

    doc.addLayer(new Layer(3500, '2F'));
    expect(doc.getPosAbove(new Point3D(100, 200, 0))).toEqual(new Point3D(100, 200, 3500));
    expect(doc.layerAbove(0)?.name).toBe('2F');
    expect(doc.layerAbove(3500)).toBeNull();

    // 直上に部材があってもレイヤーの方が近ければレイヤー高さを使う。
    const a = node(0, 0, 7000);
    const b = node(6000, 0, 7000);
    doc.addMany([a, b, new Beam(a, b)]);
    expect(doc.getPosAbove(new Point3D(100, 0, 0))).toEqual(new Point3D(100, 0, 3500));
    // レイヤーが無い高さの間では、これまで通り部材交点を使う。
    expect(doc.getPosAbove(new Point3D(100, 0, 3500))).toEqual(new Point3D(100, 0, 7000));
  });

  it('collects the nodes at a layer elevation and everything referencing them', () => {
    const lower = new Layer(0, '1F');
    const upper = new Layer(3500, '2F');
    doc.addLayer(lower);
    doc.addLayer(upper);
    const a = node(0, 0);
    const b = node(6000, 0);
    const c = node(0, 0, 3500);
    const d = node(6000, 0, 3500);
    const lowerBeam = new Beam(a, b);
    const upperBeam = new Beam(c, d);
    const pillar = new Pillar(a, c);
    doc.addMany([a, b, c, d, lowerBeam, upperBeam, pillar]);

    expect(new Set(doc.dataOnLayerElevation(upper))).toEqual(new Set([c, d, upperBeam, pillar]));
    expect(new Set(doc.dataOnLayerElevation(lower))).toEqual(new Set([a, b, lowerBeam, pillar]));
    expect(doc.dataOnLayerElevation(new Layer(9000, 'RF'))).toEqual([]);

    // 返した集合はそのまま removeMany できる（参照切れを起こさない）。
    doc.removeMany(doc.dataOnLayerElevation(upper));
    expect(doc.allDataList).toEqual([a, b, lowerBeam]);
  });
});

describe('orphan detection for deletes', () => {
  it('finds only nodes that the deleted elements leave unreferenced', () => {
    const a = node(0, 0);
    const b = node(1000, 0);
    const c = node(2000, 0);
    const loose = node(500, 500);
    const ab = new Beam(a, b);
    const bc = new Beam(b, c);
    doc.addMany([a, b, c, loose, ab, bc]);

    expect(findNodesOrphanedBy(doc, [ab])).toEqual([a]);
    expect(new Set(findNodesOrphanedBy(doc, [ab, bc]))).toEqual(new Set([a, b, c]));
    expect(findNodesOrphanedBy(doc, [ab, a])).toEqual([]);
    expect(findNodesOrphanedBy(doc, [loose])).toEqual([]);
  });
});

describe('layer copy equivalence', () => {
  it('does not duplicate a beam that already connects the same nodes with another section', () => {
    const lower = new Layer(0, '1F');
    const upper = new Layer(3500, '2F');
    doc.addLayer(lower);
    doc.addLayer(upper);
    const a = node(0, 0);
    const b = node(6000, 0);
    const lowerBeam = new Beam(a, b);
    lowerBeam.section = 'G1G2';
    const c = node(0, 0, 3500);
    const d = node(6000, 0, 3500);
    const existing = new Beam(d, c); // 逆向きでも同じ端点
    existing.section = 'G1';
    doc.addMany([a, b, c, d, lowerBeam, existing]);

    copyLayerContents(lower, upper, doc);
    expect(doc.memberList).toHaveLength(2);
    expect(doc.nodeList).toHaveLength(4);
  });

  it('treats a plane with the same vertex set as the same element regardless of start vertex', () => {
    const lower = new Layer(0, '1F');
    const upper = new Layer(3500, '2F');
    doc.addLayer(lower);
    doc.addLayer(upper);
    const square = [node(0, 0), node(1000, 0), node(1000, 1000), node(0, 1000)];
    const floor = new Floor(square);
    const upperNodes = square.map((n) => node(n.pos.x, n.pos.y, 3500));
    const rotated = new Floor([upperNodes[2], upperNodes[3], upperNodes[0], upperNodes[1]]);
    rotated.section = 'S2';
    doc.addMany([...square, floor, ...upperNodes, rotated]);

    copyLayerContents(lower, upper, doc);
    expect(doc.planeList).toHaveLength(2);
  });
});

describe('legacy JSON layer names', () => {
  it('renames repeated default layer names by elevation for v0/v1 files only', () => {
    const legacy = JSON.stringify({
      nodes: [],
      beams: [],
      layers: [
        { name: '新規レイヤー', posZ: 3000 },
        { name: '新規レイヤー', posZ: 0 },
        { name: 'RF', posZ: 6000 },
      ],
    });
    expect(parseJsonDocument(legacy).layers.map((layer) => [layer.name, layer.posZ])).toEqual([
      ['2F', 3000],
      ['1F', 0],
      ['RF', 6000],
    ]);

    const distinct = JSON.stringify({ nodes: [], layers: [{ name: '新規レイヤー', posZ: 0 }] });
    expect(parseJsonDocument(distinct).layers[0].name).toBe('新規レイヤー');

    const v2 = JSON.stringify({
      schemaVersion: 2,
      nodes: [],
      beams: [],
      pillars: [],
      trusses: [],
      springs: [],
      floors: [],
      walls: [],
      bearWalls: [],
      supports: [],
      constraints: [],
      layers: [
        { id: 'a', name: 'New Layer', posZ: 0, visible: true, locked: false },
        { id: 'b', name: 'New Layer', posZ: 3000, visible: true, locked: false },
      ],
    });
    expect(parseJsonDocument(v2).layers.map((layer) => layer.name)).toEqual(['New Layer', 'New Layer']);
  });
});

describe('user-facing model errors', () => {
  it('describes a validation error by element kind and number in the current language', () => {
    const a = node(0, 0);
    const b = node(1000, 0);
    const c = node(1000, 0, 3000);
    const d = node(0, 0, 3000);
    const wall = new Wall([a, b, c, d]);
    doc.addMany([a, b, c, d, wall]);
    const index = doc.allDataList.indexOf(wall);
    const error = new ModelValidationError(
      'non-planar vertex (distance 267.54 exceeds tolerance 0.0000037)',
      `data[${index}].nodes[3]`,
    );

    expect(describeModelError(error, doc)).toEqual({ message: '壁 0 が平面でなくなります', targets: [wall] });
    setLocale('en');
    expect(describeModelError(error, doc).message).toBe('Wall 0 would no longer be planar');

    const unknown = new ModelValidationError('expected string', `data[${index}].section`);
    expect(describeModelError(unknown, doc).message).toBe('Wall 0: expected string');
    expect(describeModelError(new Error('plain failure'), doc)).toEqual({ message: 'plain failure', targets: [] });
    expect(
      describeModelError(new ModelValidationError('member length must be greater than 0', 'data[99]'), doc),
    ).toEqual({
      message: 'The model would have zero length',
      targets: [],
    });
  });
});

describe('draft identity rotation', () => {
  it('moves the writer to a fresh family each time', () => {
    const first = rotateDraftIdentity();
    const second = rotateDraftIdentity();
    expect(first).not.toBe('');
    expect(second).not.toBe(first);
  });
});

describe('validation error target', () => {
  it('attaches the offending element so a candidate-list index is not needed', () => {
    const a = node(0, 0);
    const b = node(1000, 0);
    const c = node(1000, 0, 3000);
    const d = node(0, 500, 3000);
    const wall = new Wall([a, b, c, d]);
    doc.addMany([a, b, c, d]);
    let caught: unknown = null;
    try {
      ModelValidator.validateModel([...doc.allDataList, wall], doc.layers, { validateNumbers: false });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelValidationError);
    expect((caught as ModelValidationError).target).toBe(wall);
    expect(describeModelError(caught, doc)).toEqual({ message: '壁 0 が平面でなくなります', targets: [wall] });
  });
});

describe('transaction view notification', () => {
  it('notifies the layer view once when a transaction changes layers and the shown layer', () => {
    const listener = vi.fn();
    doc.subscribeLayerView(listener);
    doc.transaction(() => {
      const layer = new Layer(0, '1F');
      doc.addLayer(layer);
      doc.shownLayer = layer;
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(doc.shownLayer?.name).toBe('1F');
  });
});
