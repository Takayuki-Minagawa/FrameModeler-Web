import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import { deserializeCalcYaml } from '../src/io/CalcYamlDeserializer';
import { deserializeJson } from '../src/io/JsonDeserializer';
import { serializeJson } from '../src/io/JsonSerializer';

const doc = Document.instance;

function readSample(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'sample-data', name), 'utf-8');
}

function exactCount(ctor: Function): number {
  return doc.allDataList.filter((d) => d.constructor === ctor).length;
}

function coords(): number[][] {
  return doc.nodeList.map((n) => [n.pos.x, n.pos.y, n.pos.z]);
}

function readCalcObject(): any {
  return parse(readSample('Test0202_calc.yaml'));
}

describe('Calc YAML import', () => {
  beforeEach(() => {
    doc.init();
  });

  it('imports Test0202_calc.yaml as a CAD model using traceability', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'));

    expect(summary.nodes).toBe(10);
    expect(summary.beams).toBe(6);
    expect(summary.pillars).toBe(0);
    expect(summary.floors).toBe(4);
    expect(summary.walls).toBe(0);
    expect(summary.bearWalls).toBe(0);
    expect(summary.layers).toBe(1);

    expect(exactCount(Node)).toBe(10);
    expect(exactCount(Beam)).toBe(6);
    expect(exactCount(Floor)).toBe(4);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0].name).toBe('L1');
    expect(doc.layers[0].posZ).toBe(2800);
  });

  it('creates the expected shared CAD nodes from source nodes and floor boundaries', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));

    expect(coords()).toEqual([
      [0, 0, 2800],
      [500, 0, 2800],
      [1000, 0, 2800],
      [1500, 0, 2800],
      [2000, 0, 2800],
      [0, 2000, 2800],
      [500, 2000, 2800],
      [1000, 2000, 2800],
      [1500, 2000, 2800],
      [2000, 2000, 2800],
    ]);
  });

  it('keeps YAML source ids separate from app numbers', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'));

    expect(doc.nodeList.map((n) => n.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const nodeRows = summary.sourceIdMap.filter((row) => row.kind === 'node');
    expect([...new Set(nodeRows.map((row) => row.appNumber))].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(nodeRows.map((row) => row.sourceId)).toEqual(expect.arrayContaining(['1', '2', '3', '4']));
    expect(nodeRows.find((row) => row.sourceId === '1')?.appNumber).toBe(0);
    expect(nodeRows.find((row) => row.sourceId === '2')?.appNumber).toBe(5);
    expect(nodeRows.find((row) => row.sourceId === '3')?.appNumber).toBe(4);
    expect(nodeRows.find((row) => row.sourceId === '4')?.appNumber).toBe(9);
  });

  it('creates source beam members and hbraces with section information', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'));

    const memberRows = summary.sourceIdMap.filter((row) => row.kind === 'member');
    expect(memberRows.map((row) => row.sourceId).sort()).toEqual(['M001', 'M002', 'M003', 'M004', 'M005', 'M006']);
    expect(memberRows.filter((row) => row.type === 'Beam')).toHaveLength(4);
    expect(memberRows.filter((row) => row.type === 'Beam(hbrace)')).toHaveLength(2);

    const beams = doc.memberList.filter((m): m is Beam => m.constructor === Beam);
    expect(beams.map((beam) => beam.section).sort()).toEqual(['B', 'B', 'B', 'B', 'V', 'V']);
    expect(summary.warnings.filter((warning) => warning.code === 'HBRACE_AS_BEAM')).toHaveLength(2);
  });

  it('creates source floors with section S', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'));

    const planeRows = summary.sourceIdMap.filter((row) => row.kind === 'plane');
    expect(planeRows.map((row) => row.sourceId).sort()).toEqual(['S001', 'S002', 'S003', 'S004']);
    const floors = doc.planeList.filter((p): p is Floor => p.constructor === Floor);
    expect(floors.map((floor) => floor.section)).toEqual(['S', 'S', 'S', 'S']);
  });

  it('returns material and section properties in ImportSummary', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'));

    expect(summary.materials.steel.elastic_modulus).toBe(205000);
    expect(summary.materials.steel.shear_modulus).toBe(79000);
    expect(summary.materials.alc.elastic_modulus).toBe(1800);
    expect(summary.materials.alc.shear_modulus).toBe(750);
    expect(summary.sections.B.area).toBe(20000);
    expect(summary.sections.B.inertia_y).toBe(66700000);
    expect(summary.sections.B.inertia_z).toBe(16700000);
    expect(summary.sections.ALC_S_center_beam.area).toBe(50000);
    expect(summary.sections.ALC_S_center_beam.inertia_y).toBe(41700000);
    expect(summary.sections.ALC_S_center_beam.inertia_z).toBe(1040000000);
  });

  it('infers steel for beam source types even when section starts with S', async () => {
    const calc = readCalcObject();
    calc.model.traceability.source_members[0].source_section = 'SN400';
    delete calc.model.traceability.source_members[0].generated_element_chain;

    const summary = await deserializeCalcYaml(stringify(calc));

    const row = summary.sourceIdMap.find((item) => item.sourceId === 'M001');
    expect(row?.detail).toContain('section=SN400');
    expect(row?.detail).toContain('material=steel');
  });

  it('returns warnings for unsupported or non-persisted analysis data', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const codes = summary.warnings.map((warning) => warning.code);

    expect(codes).toContain('SUPPORTS_NOT_IMPORTED');
    expect(codes).toContain('NODAL_MASSES_NOT_IMPORTED');
    expect(codes).toContain('CONSTRAINTS_NOT_IMPORTED');
    expect(codes).toContain('SPRINGS_NOT_IMPORTED');
    expect(codes).toContain('PROPERTIES_SUMMARY_ONLY');
    expect(summary.warnings.find((warning) => warning.code === 'SUPPORTS_NOT_IMPORTED')?.message).toContain('68');
    expect(summary.warnings.find((warning) => warning.code === 'NODAL_MASSES_NOT_IMPORTED')?.message).toContain('64');
    expect(summary.warnings.find((warning) => warning.code === 'CONSTRAINTS_NOT_IMPORTED')?.message).toContain('72');
    expect(summary.warnings.find((warning) => warning.code === 'SPRINGS_NOT_IMPORTED')?.message).toContain('13');
  });

  it('rejects unsupported length units and leaves Document unchanged', async () => {
    doc.bulkLoad([new Node(new Point3D(1, 2, 3))], []);
    const before = serializeJson();
    const yaml = readSample('Test0202_calc.yaml').replace('length: mm', 'length: m');

    await expect(deserializeCalcYaml(yaml)).rejects.toThrow(/Unsupported calc YAML length unit/);
    expect(serializeJson()).toBe(before);
  });

  it('accepts numeric schema_version values', async () => {
    const yaml = readSample('Test0202_calc.yaml').replace("schema_version: '1'", 'schema_version: 1');

    const summary = await deserializeCalcYaml(yaml);

    expect(summary.nodes).toBe(10);
    expect(summary.beams).toBe(6);
  });

  it('keeps nearby source nodes distinct instead of tolerance-merging them', async () => {
    const calc = readCalcObject();
    const sourceNode3 = calc.model.traceability.source_nodes.find((node: any) => node.source_node_id === 3);
    sourceNode3.coord = [0.3, 0, 2800];

    await deserializeCalcYaml(stringify(calc));

    expect(doc.nodeList.some((node) => node.pos.x === 0.3 && node.pos.y === 0)).toBe(true);
    expect(doc.memberList.some((member) => member.posI.sub(member.posJ).length <= 0.5)).toBe(true);
    expect(doc.memberList.every((member) => member.nodeI !== member.nodeJ)).toBe(true);
  });

  it('rejects malformed YAML and leaves Document unchanged', async () => {
    doc.bulkLoad([new Node(new Point3D(1, 2, 3))], []);
    const before = serializeJson();

    await expect(deserializeCalcYaml('schema_version: [')).rejects.toThrow(/Invalid YAML document/);
    expect(serializeJson()).toBe(before);
  });

  it('rejects source members that reference missing source nodes', async () => {
    const yaml = readSample('Test0202_calc.yaml').replace(
      'source_nodes:\n      - 1\n      - 2',
      'source_nodes:\n      - 1\n      - 99999',
    );

    await expect(deserializeCalcYaml(yaml)).rejects.toThrow(/M001.*99999/);
    expect(doc.allDataList.length).toBe(0);
  });

  it('rejects source members that resolve to the same CAD node at both ends', async () => {
    const yaml = readSample('Test0202_calc.yaml').replace(
      'source_nodes:\n      - 1\n      - 2',
      'source_nodes:\n      - 1\n      - 1',
    );

    await expect(deserializeCalcYaml(yaml)).rejects.toThrow(/M001.*same CAD node/);
    expect(doc.allDataList.length).toBe(0);
  });

  it('rejects invalid floor rectangles', async () => {
    const calc = readCalcObject();
    calc.model.traceability.source_surfaces[0].source_rect.x2 = calc.model.traceability.source_surfaces[0].source_rect.x1;

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(/S001.*zero-area/);
    expect(doc.allDataList.length).toBe(0);
  });

  it('serializes YAML-imported data as existing JSON format without metadata tables', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const json = JSON.parse(serializeJson());

    expect(Object.keys(json).sort()).toEqual(['beams', 'bearWalls', 'floors', 'layers', 'nodes', 'pillars', 'walls']);
    expect(json.nodes).toHaveLength(10);
    expect(json.beams).toHaveLength(6);
    expect(json.floors).toHaveLength(4);
    expect(json.layers).toHaveLength(1);
    expect(json.materials).toBeUndefined();
    expect(json.sections).toBeUndefined();
    expect(json.traceability).toBeUndefined();
  });

  it('round-trips YAML-imported model through JSON without count changes', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const json = serializeJson();

    doc.init();
    deserializeJson(json);

    expect(exactCount(Node)).toBe(10);
    expect(exactCount(Beam)).toBe(6);
    expect(exactCount(Floor)).toBe(4);
    expect(doc.layers.length).toBe(1);
    expect(doc.memberList.map((m) => m.section).sort()).toEqual(['B', 'B', 'B', 'B', 'V', 'V']);
    expect(doc.planeList.filter((p): p is Floor => p.constructor === Floor).map((floor) => floor.section)).toEqual(['S', 'S', 'S', 'S']);
    expect(doc.importMetadata).toBeNull();
  });

  it('clears import metadata when the document is edited after import', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    expect(doc.importMetadata).not.toBeNull();

    doc.add(new Node(new Point3D(9999, 0, 2800)));

    expect(doc.importMetadata).toBeNull();
  });
});
