import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { BearWall } from '../src/data/BearWall';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { Pillar } from '../src/data/Pillar';
import { Support } from '../src/data/Support';
import { exportDxf } from '../src/io/DxfExporter';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

interface DxfEntity {
  type: string;
  layer: string;
  /** group code → 出現順の値 */
  values: Map<number, string[]>;
}

/** ENTITIES セクションを group code の対として読み戻す。 */
function parseEntities(dxf: string): DxfEntity[] {
  const lines = dxf.split('\r\n');
  expect(lines.at(-1)).toBe('');
  expect((lines.length - 1) % 2).toBe(0);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]]);

  const start = pairs.findIndex(
    ([code, value], index) => code === 2 && value === 'ENTITIES' && pairs[index - 1][1] === 'SECTION',
  );
  const entities: DxfEntity[] = [];
  for (const [code, value] of pairs.slice(start + 1)) {
    if (code === 0) {
      if (value === 'ENDSEC') break;
      entities.push({ type: value, layer: '', values: new Map() });
      continue;
    }
    const entity = entities.at(-1)!;
    if (code === 8) entity.layer = value;
    entity.values.set(code, [...(entity.values.get(code) ?? []), value]);
  }
  return entities;
}

function buildFrame(): { lower: Layer; upper: Layer; beam: Beam; floor: Floor } {
  const lower = new Layer(0, '1F');
  const upper = new Layer(3000, '2F');
  doc.addLayer(lower);
  doc.addLayer(upper);
  const base = [node(0, 0), node(6000, 0), node(6000, 4000), node(0, 4000)];
  const top = [node(0, 0, 3000), node(6000, 0, 3000), node(6000, 4000, 3000), node(0, 4000, 3000)];
  const beam = new Beam(top[0], top[1]);
  beam.section = '大梁G1';
  const pillar = new Pillar(base[0], top[0]);
  const floor = new Floor(top);
  const wall = new BearWall([base[0], base[1], top[1], top[0]]);
  doc.addMany([...base, ...top, beam, pillar, floor, wall, new Support(base[0], ['uz'])]);
  return { lower, upper, beam, floor };
}

describe('exportDxf', () => {
  it('writes an R12 file with header, tables and a terminated entities section', () => {
    buildFrame();
    const dxf = exportDxf(doc, { layer: null });
    const lines = dxf.split('\r\n');
    expect(lines.slice(0, 8)).toEqual(['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009']);
    expect(lines.slice(-5)).toEqual(['0', 'ENDSEC', '0', 'EOF', '']);
    for (const name of ['NODE', 'BEAM', 'PILLAR', 'TRUSS', 'SPRING', 'FLOOR', 'WALL', 'BEARWALL', 'SECTION']) {
      expect(dxf).toContain(`\r\nLAYER\r\n2\r\n${name}\r\n`);
    }
    // 出力はASCIIだけにする（R12は文字コードを宣言できない）。
    expect([...dxf].every((char) => char.charCodeAt(0) < 0x80)).toBe(true);
  });

  it('exports the whole model in 3D when no layer is given', () => {
    buildFrame();
    const entities = parseEntities(exportDxf(doc, { layer: null }));
    const byType = (type: string, layer: string): DxfEntity[] =>
      entities.filter((entity) => entity.type === type && entity.layer === layer);

    expect(byType('POINT', 'NODE')).toHaveLength(8);
    expect(byType('LINE', 'BEAM')).toHaveLength(1);
    const pillar = byType('LINE', 'PILLAR')[0];
    expect([pillar.values.get(30)![0], pillar.values.get(31)![0]]).toEqual(['0', '3000']);
    // 面材は閉じた3Dポリライン（flag 1 + 8）。
    for (const layer of ['FLOOR', 'BEARWALL']) {
      const polyline = byType('POLYLINE', layer)[0];
      expect(polyline.values.get(70)).toEqual(['9']);
    }
    expect(entities.filter((entity) => entity.type === 'VERTEX')).toHaveLength(8);
    expect(entities.filter((entity) => entity.type === 'SEQEND')).toHaveLength(2);
    // 支点・拘束は図形を持たない。
    expect(entities.some((entity) => entity.layer === '')).toBe(false);
  });

  it('exports a storey plan flattened to the layer elevation', () => {
    const { upper } = buildFrame();
    const entities = parseEntities(exportDxf(doc, { layer: upper }));
    const types = (layer: string): string[] =>
      entities.filter((entity) => entity.layer === layer).map((entity) => entity.type);

    expect(types('NODE')).toEqual(['POINT', 'POINT', 'POINT', 'POINT']);
    expect(types('BEAM')).toEqual(['LINE']);
    // 階を貫く柱は円、階に立つ壁は階の高さにある辺の開いたポリライン。
    expect(types('PILLAR')).toEqual(['CIRCLE']);
    const wall = entities.find((entity) => entity.layer === 'BEARWALL' && entity.type === 'POLYLINE')!;
    expect(wall.values.get(70)).toEqual(['0']);
    const floor = entities.find((entity) => entity.layer === 'FLOOR' && entity.type === 'POLYLINE')!;
    expect(floor.values.get(70)).toEqual(['1']);

    const elevations = entities.flatMap((entity) => [
      ...(entity.values.get(30) ?? []),
      ...(entity.values.get(31) ?? []),
    ]);
    expect(new Set(elevations)).toEqual(new Set(['3000']));

    const circle = entities.find((entity) => entity.type === 'CIRCLE')!;
    expect(circle.values.get(40)).toEqual(['150']);
    expect([circle.values.get(10)![0], circle.values.get(20)![0]]).toEqual(['0', '0']);
  });

  it('only includes elements that exist on the requested layer and pass the filter', () => {
    const { lower, beam } = buildFrame();
    const lowerEntities = parseEntities(exportDxf(doc, { layer: lower }));
    expect(lowerEntities.some((entity) => entity.layer === 'BEAM')).toBe(false);
    expect(lowerEntities.some((entity) => entity.layer === 'FLOOR')).toBe(false);
    expect(lowerEntities.filter((entity) => entity.type === 'POINT')).toHaveLength(4);

    const filtered = parseEntities(exportDxf(doc, { layer: null, include: (data) => data !== beam }));
    expect(filtered.some((entity) => entity.layer === 'BEAM')).toBe(false);
  });

  it('labels sections with escaped non-ASCII text and custom sizes', () => {
    const { upper } = buildFrame();
    const entities = parseEntities(exportDxf(doc, { layer: upper, textHeight: 200, columnSymbolRadius: 80 }));
    const texts = entities.filter((entity) => entity.type === 'TEXT');
    expect(texts.every((entity) => entity.layer === 'SECTION')).toBe(true);
    expect(texts.map((entity) => entity.values.get(1)![0])).toEqual(
      expect.arrayContaining(['\\U+5927\\U+6881G1', 'C1', 'S1', 'V1']),
    );
    expect(texts.every((entity) => entity.values.get(40)![0] === '200')).toBe(true);
    expect(entities.find((entity) => entity.type === 'CIRCLE')!.values.get(40)).toEqual(['80']);
  });

  it('formats fractional coordinates with at most six decimals and omits empty labels', () => {
    const a = node(0.1 + 0.2, 1 / 3);
    const b = node(1000, 0);
    const beam = new Beam(a, b);
    beam.section = '  ';
    doc.addMany([a, b, beam]);
    const entities = parseEntities(exportDxf(doc, { layer: null }));
    const line = entities.find((entity) => entity.type === 'LINE')!;
    expect(line.values.get(10)).toEqual(['0.3']);
    expect(line.values.get(20)).toEqual(['0.333333']);
    expect(entities.some((entity) => entity.type === 'TEXT')).toBe(false);
  });
});
