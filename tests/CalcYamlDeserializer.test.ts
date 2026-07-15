import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Node } from '../src/data/Node';
import { Constraint } from '../src/data/Constraint';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { Point3D } from '../src/math/Point3D';
import { deserializeCalcYaml } from '../src/io/CalcYamlDeserializer';
import { deserializeJson, importDocumentJson } from '../src/io/JsonDeserializer';
import { exportDocumentJson, serializeJson } from '../src/io/JsonSerializer';

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
    expect(summary.beams).toBe(4);
    expect(summary.trusses).toBe(2);
    expect(summary.pillars).toBe(0);
    expect(summary.floors).toBe(4);
    expect(summary.walls).toBe(0);
    expect(summary.bearWalls).toBe(0);
    expect(summary.layers).toBe(1);

    expect(exactCount(Node)).toBe(10);
    expect(exactCount(Beam)).toBe(4);
    expect(exactCount(Truss)).toBe(2);
    expect(exactCount(Floor)).toBe(4);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0].name).toBe('L1');
    expect(doc.layers[0].posZ).toBe(2800);
  });

  it('keeps explicit source mode compatible with the default import', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'), { mode: 'source' });

    expect(summary.format).toBe('calc-yaml');
    expect(summary.importMode).toBe('source');
    expect(summary.nodes).toBe(10);
    expect(summary.beams).toBe(4);
    expect(summary.trusses).toBe(2);
    expect(summary.floors).toBe(4);
    expect(exactCount(Node)).toBe(10);
    expect(exactCount(Beam)).toBe(4);
    expect(exactCount(Truss)).toBe(2);
    expect(exactCount(Floor)).toBe(4);
  });

  it('imports generated analysis entities without flattening their model types', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'), { mode: 'generated' });

    expect(summary.format).toBe('calc-yaml-generated');
    expect(summary.importMode).toBe('generated');
    expect(summary.nodes).toBe(76);
    expect(summary.beams).toBe(64);
    expect(summary.trusses).toBe(2);
    expect(summary.springs).toBe(13);
    expect(summary.supports).toBe(68);
    expect(summary.constraints).toBe(72);
    expect(summary.floors).toBe(0);
    expect(summary.layers).toBe(1);
    expect(exactCount(Node)).toBe(76);
    expect(exactCount(Beam)).toBe(64);
    expect(exactCount(Truss)).toBe(2);
    expect(exactCount(Spring)).toBe(13);
    expect(exactCount(Support)).toBe(68);
    expect(exactCount(Constraint)).toBe(72);
    expect(exactCount(Floor)).toBe(0);
    expect(doc.layers[0].name).toBe('L1');
    expect(doc.layers[0].posZ).toBe(2800);
  });

  it('keeps generated node tags separate even when coordinates are identical', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'), { mode: 'generated' });

    const duplicateCoordNodes = doc.nodeList.filter(
      (node) => node.pos.x === 250 && node.pos.y === 0 && node.pos.z === 2800,
    );
    expect(duplicateCoordNodes).toHaveLength(2);

    const sourceIds = duplicateCoordNodes
      .flatMap((node) => doc.getImportSourceNodes(node) ?? [])
      .map((info) => info.sourceId)
      .sort();
    expect(sourceIds).toEqual(['101', '3001']);
    expect(summary.warnings.map((warning) => warning.code)).toContain('DUPLICATE_GENERATED_NODE_COORDS');
  });

  it('keeps generated element type, section, material, and origin metadata', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'), { mode: 'generated' });

    const typeCounts = summary.sourceIdMap
      .filter((row) => row.kind === 'member')
      .reduce<Record<string, number>>((acc, row) => {
        acc[row.type] = (acc[row.type] ?? 0) + 1;
        return acc;
      }, {});
    expect(typeCounts).toEqual({
      elasticTimoshenkoBeam3D: 64,
      truss3D: 2,
      twoNodeLink3D: 13,
    });

    const sectionCounts = doc.memberList
      .filter((member): member is Beam => member.constructor === Beam)
      .reduce<Record<string, number>>((acc, beam) => {
        acc[beam.section] = (acc[beam.section] ?? 0) + 1;
        return acc;
      }, {});
    expect(sectionCounts).toEqual({
      B: 32,
      ALC_S_center_beam: 32,
    });
    expect(doc.memberList.filter((member) => member.kind === 'truss').map((member) => member.section)).toEqual([
      'TRUSS',
      'TRUSS',
    ]);
    expect(
      doc.memberList.filter((member) => member.kind === 'spring').every((member) => member.section === 'SPRING'),
    ).toBe(true);

    const sourceElements = doc.memberList.flatMap((member) => doc.getImportSourceElements(member) ?? []);
    const beam1001 = sourceElements.find((info) => info.sourceId === '1001');
    expect(beam1001?.sourceType).toBe('elasticTimoshenkoBeam3D');
    expect(beam1001?.nodeSourceIds).toEqual(['1', '101']);
    expect(beam1001?.section).toBe('B');
    expect(beam1001?.material).toBe('steel');
    expect(beam1001?.notes?.join(' ')).toContain('Generated from M');

    const floorBeam3001 = sourceElements.find(
      (info) => info.section === 'ALC_S_center_beam' && info.material === 'alc' && info.notes?.join(' ').includes('S'),
    );
    expect(floorBeam3001?.section).toBe('ALC_S_center_beam');
    expect(floorBeam3001?.material).toBe('alc');
    expect(floorBeam3001?.notes?.join(' ')).toContain('Generated from S');

    const spring5001 = sourceElements.find((info) => info.sourceId === '5001');
    expect(spring5001?.sourceType).toBe('twoNodeLink3D');
    expect(spring5001?.section).toBe('SPRING');
    const spring = doc.memberList.find(
      (member): member is Spring =>
        member.kind === 'spring' && doc.getImportSourceElements(member)?.includes(spring5001!) === true,
    );
    expect(spring?.components).toEqual([{ dof: 'ry', stiffness: 200000000, unit: 'N*mm/rad' }]);
    expect(spring?.note).toBe('Kr panel end rotational spring');
    expect(summary.warnings.map((warning) => warning.code)).not.toContain('SPRINGS_NOT_IMPORTED');
    expect(summary.warnings.map((warning) => warning.code)).not.toContain('SPRINGS_IMPORTED_AS_BEAM');
  });

  it('preserves a zero-length twoNodeLink3D as a Spring when its node tags are distinct', async () => {
    const calc = readCalcObject();
    const spring = calc.model.elements.find((element: any) => element.tag === 5001);
    const nodeI = calc.model.nodes.find((node: any) => node.tag === spring.node_i);
    const nodeJ = calc.model.nodes.find((node: any) => node.tag === spring.node_j);
    nodeJ.x = nodeI.x;
    nodeJ.y = nodeI.y;
    nodeJ.z = nodeI.z;

    await deserializeCalcYaml(stringify(calc), { mode: 'generated' });

    const imported = doc.memberList.find(
      (member): member is Spring =>
        member.kind === 'spring' &&
        doc.getImportSourceElements(member)?.some((info) => info.sourceId === '5001') === true,
    );
    expect(imported).toBeInstanceOf(Spring);
    expect(imported?.nodeI).not.toBe(imported?.nodeJ);
    expect(imported?.posI.sub(imported.posJ).length).toBe(0);
  });

  it('rejects a twoNodeLink3D that uses the same node tag at both ends', async () => {
    const calc = readCalcObject();
    const spring = calc.model.elements.find((element: any) => element.tag === 5001);
    spring.node_j = spring.node_i;

    await expect(deserializeCalcYaml(stringify(calc), { mode: 'generated' })).rejects.toThrow(
      /5001.*distinct node tags/,
    );
    expect(doc.allDataList).toHaveLength(0);
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
    expect([...new Set(nodeRows.map((row) => row.appNumber))].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(nodeRows.map((row) => row.sourceId)).toEqual(expect.arrayContaining(['1', '2', '3', '4']));
    expect(nodeRows.find((row) => row.sourceId === '1')?.appNumber).toBe(0);
    expect(nodeRows.find((row) => row.sourceId === '2')?.appNumber).toBe(5);
    expect(nodeRows.find((row) => row.sourceId === '3')?.appNumber).toBe(4);
    expect(nodeRows.find((row) => row.sourceId === '4')?.appNumber).toBe(9);
  });

  it('keeps source hbraces as Truss elements with generated axial properties', async () => {
    const summary = await deserializeCalcYaml(readSample('Test0202_calc.yaml'));

    const memberRows = summary.sourceIdMap.filter((row) => row.kind === 'member');
    expect(memberRows.map((row) => row.sourceId).sort()).toEqual(['M001', 'M002', 'M003', 'M004', 'M005', 'M006']);
    expect(memberRows.filter((row) => row.type === 'Beam')).toHaveLength(4);
    expect(memberRows.filter((row) => row.type === 'Truss(hbrace)')).toHaveLength(2);

    const beams = doc.memberList.filter((m): m is Beam => m.constructor === Beam);
    expect(beams.map((beam) => beam.section).sort()).toEqual(['B', 'B', 'B', 'B']);
    const braces = doc.memberList.filter((member): member is Truss => member.kind === 'truss');
    expect(braces).toHaveLength(2);
    expect(braces.map((brace) => brace.section)).toEqual(['V', 'V']);
    expect(braces.map((brace) => brace.area)).toEqual([225, 225]);
    expect(braces.map((brace) => brace.areaUnit)).toEqual(['mm^2', 'mm^2']);
    expect(braces.map((brace) => brace.elasticModulus)).toEqual([205000, 205000]);
    expect(braces.map((brace) => brace.material)).toEqual(['steel', 'steel']);
    expect(summary.warnings.map((warning) => warning.code)).not.toContain('HBRACE_AS_BEAM');
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

  it('keeps prototype-like YAML table keys as inert own data properties', async () => {
    const calc = readCalcObject();
    calc.units = Object.fromEntries([
      ...Object.entries(calc.units),
      ['__proto__', 'proto-unit'],
      ['constructor', 'constructor-unit'],
      ['prototype', 'prototype-unit'],
    ]);
    for (const field of ['materials', 'sections']) {
      calc.model[field] = Object.fromEntries([
        ...Object.entries(calc.model[field]),
        ['__proto__', { pollutedByCalcYaml: true }],
        ['constructor', { value: 'ctor' }],
        ['prototype', { value: 'proto' }],
      ]);
    }

    const summary = await deserializeCalcYaml(stringify(calc));

    expect(Object.getPrototypeOf(summary.units)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(summary.units, '__proto__')).toBe(true);
    expect(summary.units['__proto__']).toBe('proto-unit');
    expect(summary.units.constructor).toBe('constructor-unit');
    expect(summary.units.prototype).toBe('prototype-unit');
    for (const propertyTable of [summary.materials, summary.sections]) {
      expect(Object.getPrototypeOf(propertyTable)).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(propertyTable, '__proto__')).toBe(true);
      expect(propertyTable['__proto__']).toEqual({ pollutedByCalcYaml: true });
      expect(propertyTable.constructor).toEqual({ value: 'ctor' });
      expect(propertyTable.prototype).toEqual({ value: 'proto' });
      expect(propertyTable.pollutedByCalcYaml).toBeUndefined();
    }
    expect(({} as { pollutedByCalcYaml?: boolean }).pollutedByCalcYaml).toBeUndefined();
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
    expect(codes).not.toContain('PROPERTIES_SUMMARY_ONLY');
    expect(summary.warnings.find((warning) => warning.code === 'SUPPORTS_NOT_IMPORTED')?.message).toContain('68');
    expect(summary.warnings.find((warning) => warning.code === 'NODAL_MASSES_NOT_IMPORTED')?.message).toContain('64');
    expect(summary.warnings.find((warning) => warning.code === 'CONSTRAINTS_NOT_IMPORTED')?.message).toContain('72');
    expect(summary.warnings.find((warning) => warning.code === 'SPRINGS_NOT_IMPORTED')?.message).toContain('13');
  });

  it('does not require model.elements for source mode', async () => {
    const calc = readCalcObject();
    delete calc.model.elements;

    const summary = await deserializeCalcYaml(stringify(calc));

    expect(summary.nodes).toBe(10);
    expect(summary.beams).toBe(4);
    expect(summary.trusses).toBe(2);
    expect(summary.floors).toBe(4);
    expect(summary.warnings.map((warning) => warning.code)).not.toContain('SPRINGS_NOT_IMPORTED');
    expect(summary.warnings.filter((warning) => warning.code === 'HBRACE_AREA_DEFAULTED')).toHaveLength(2);
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
    expect(summary.beams).toBe(4);
    expect(summary.trusses).toBe(2);
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

  it('validates optional summary fields before atomically replacing the Document', async () => {
    doc.bulkLoad([new Node(new Point3D(1, 2, 3))], []);
    const before = serializeJson();
    const calc = readCalcObject();
    calc.model.name = { invalid: true };

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(/model\.name.*expected string/);
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
    calc.model.traceability.source_surfaces[0].source_rect.x2 =
      calc.model.traceability.source_surfaces[0].source_rect.x1;

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(/S001.*zero-area/);
    expect(doc.allDataList.length).toBe(0);
  });

  it('serializes YAML provenance inside the optional v2 importMetadata field', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const json = JSON.parse(serializeJson());

    expect(Object.keys(json).sort()).toEqual([
      'beams',
      'bearWalls',
      'constraints',
      'floors',
      'importMetadata',
      'layers',
      'nodes',
      'pillars',
      'schemaVersion',
      'springs',
      'supports',
      'trusses',
      'walls',
    ]);
    expect(json.schemaVersion).toBe(2);
    expect(json.nodes).toHaveLength(10);
    expect(json.beams).toHaveLength(4);
    expect(json.trusses).toHaveLength(2);
    expect(json.floors).toHaveLength(4);
    expect(json.layers).toHaveLength(1);
    expect(json.materials).toBeUndefined();
    expect(json.sections).toBeUndefined();
    expect(json.traceability).toBeUndefined();
    expect(json.importMetadata.summary.format).toBe('calc-yaml');
    expect(json.importMetadata.sourceNodes).toHaveLength(10);
    expect(json.importMetadata.sourceElements).toHaveLength(10);
    expect(json.importMetadata.materials.steel.elastic_modulus).toBe(205000);
    expect(json.importMetadata.sourceElements[0].data).toEqual({ category: 'member', number: expect.any(Number) });
  });

  it('serializes generated-element provenance using stable data references', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'), { mode: 'generated' });
    const json = JSON.parse(serializeJson());

    expect(Object.keys(json).sort()).toEqual([
      'beams',
      'bearWalls',
      'constraints',
      'floors',
      'importMetadata',
      'layers',
      'nodes',
      'pillars',
      'schemaVersion',
      'springs',
      'supports',
      'trusses',
      'walls',
    ]);
    expect(json.schemaVersion).toBe(2);
    expect(json.nodes).toHaveLength(76);
    expect(json.nodes.filter((node: any) => node.mass !== undefined)).toHaveLength(64);
    expect(json.beams).toHaveLength(64);
    expect(json.trusses).toHaveLength(2);
    expect(json.springs).toHaveLength(13);
    expect(json.supports).toHaveLength(68);
    expect(json.constraints).toHaveLength(72);
    expect(json.floors).toHaveLength(0);
    expect(json.layers).toHaveLength(1);
    expect(json.materials).toBeUndefined();
    expect(json.sections).toBeUndefined();
    expect(json.traceability).toBeUndefined();
    expect(json.importMetadata.summary.format).toBe('calc-yaml-generated');
    expect(json.importMetadata.sourceNodes).toHaveLength(76);
    expect(json.importMetadata.sourceElements).toHaveLength(219);
  });

  it('round-trips YAML-imported model through JSON without count changes', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const json = serializeJson();

    doc.init();
    deserializeJson(json);

    expect(exactCount(Node)).toBe(10);
    expect(exactCount(Beam)).toBe(4);
    expect(exactCount(Truss)).toBe(2);
    expect(exactCount(Floor)).toBe(4);
    expect(doc.layers.length).toBe(1);
    expect(doc.memberList.map((m) => m.section).sort()).toEqual(['B', 'B', 'B', 'B', 'V', 'V']);
    expect(
      doc.memberList.filter((member): member is Truss => member.kind === 'truss').map((brace) => brace.area),
    ).toEqual([225, 225]);
    expect(doc.planeList.filter((p): p is Floor => p.constructor === Floor).map((floor) => floor.section)).toEqual([
      'S',
      'S',
      'S',
      'S',
    ]);
    expect(doc.importMetadata?.summary.format).toBe('calc-yaml');
    expect(doc.importMetadata?.materials.steel.elastic_modulus).toBe(205000);
    const sourceM001 = doc.memberList
      .flatMap((member) => doc.getImportSourceElements(member) ?? [])
      .find((info) => info.sourceId === 'M001');
    expect(sourceM001?.sourceType).toBe('beam');
    expect(sourceM001?.elementTags).toEqual([1017, 1018, 1019, 1020, 1021, 1022, 1023, 1024]);
  });

  it('round-trips generated element imports through JSON without count changes', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'), { mode: 'generated' });
    const json = serializeJson();

    doc.init();
    deserializeJson(json);

    expect(exactCount(Node)).toBe(76);
    expect(exactCount(Beam)).toBe(64);
    expect(exactCount(Truss)).toBe(2);
    expect(exactCount(Spring)).toBe(13);
    expect(exactCount(Support)).toBe(68);
    expect(exactCount(Constraint)).toBe(72);
    expect(exactCount(Floor)).toBe(0);
    expect(doc.layers.length).toBe(1);
    expect(doc.importMetadata?.summary.format).toBe('calc-yaml-generated');
    const generated5001 = doc.memberList
      .flatMap((member) => doc.getImportSourceElements(member) ?? [])
      .find((info) => info.sourceId === '5001');
    expect(generated5001?.sourceType).toBe('twoNodeLink3D');
  });

  it('uses the shared export/import API for history and draft restoration', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const exported = exportDocumentJson();

    doc.init();
    importDocumentJson(JSON.stringify(exported));

    expect(doc.importMetadata?.summary.format).toBe('calc-yaml');
    expect(doc.importMetadata?.sourceNodes.size).toBe(10);
    expect(doc.importMetadata?.sourceElements.size).toBe(10);
  });

  it('keeps versioned model and provenance JSON byte-stable after round trip', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const first = serializeJson();

    doc.init();
    deserializeJson(first);

    expect(serializeJson()).toBe(first);
  });

  it('rejects a missing stable metadata reference before replacing the current Document', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const invalid = JSON.parse(serializeJson());
    invalid.importMetadata.sourceNodes[0].data.number = 999999;

    doc.bulkLoad([new Node(new Point3D(9, 8, 7))], []);
    const before = serializeJson();
    expect(() => deserializeJson(JSON.stringify(invalid))).toThrow(/model reference not found.*node:999999/);
    expect(serializeJson()).toBe(before);
  });

  it('rejects importMetadata summary counts that disagree with the model', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const invalid = JSON.parse(serializeJson());
    invalid.importMetadata.summary.beams++;

    doc.init();
    expect(() => deserializeJson(JSON.stringify(invalid))).toThrow(/importMetadata\.summary\.beams.*expected 4.*got 5/);
    expect(doc.allDataList).toHaveLength(0);
  });

  it('rejects generated elements that reference missing generated nodes and leaves Document unchanged', async () => {
    doc.bulkLoad([new Node(new Point3D(1, 2, 3))], []);
    const before = serializeJson();
    const calc = readCalcObject();
    calc.model.elements[0].node_j = 99999;

    await expect(deserializeCalcYaml(stringify(calc), { mode: 'generated' })).rejects.toThrow(/1001.*99999/);
    expect(serializeJson()).toBe(before);
  });

  it('rejects malformed generated traceability instead of silently dropping metadata', async () => {
    doc.bulkLoad([new Node(new Point3D(1, 2, 3))], []);
    const before = serializeJson();
    const calc = readCalcObject();
    calc.model.traceability = [];

    await expect(deserializeCalcYaml(stringify(calc), { mode: 'generated' })).rejects.toThrow(/model\.traceability/);
    expect(serializeJson()).toBe(before);
  });

  it('rejects empty generated node lists before clearing the current document', async () => {
    doc.bulkLoad([new Node(new Point3D(1, 2, 3))], []);
    const before = serializeJson();
    const calc = readCalcObject();
    calc.model.nodes = [];

    await expect(deserializeCalcYaml(stringify(calc), { mode: 'generated' })).rejects.toThrow(/model\.nodes/);
    expect(serializeJson()).toBe(before);
  });

  it('skips generated nodes that are not referenced by supported generated elements', async () => {
    const calc = readCalcObject();
    calc.model.nodes.push({ tag: 999001, x: 999, y: 999, z: 2800 });

    const summary = await deserializeCalcYaml(stringify(calc), { mode: 'generated' });

    expect(summary.nodes).toBe(76);
    expect(
      doc.getImportSourceNodes(doc.nodeList[doc.nodeList.length - 1])?.some((info) => info.sourceId === '999001'),
    ).not.toBe(true);
    expect(summary.warnings.map((warning) => warning.code)).toContain('UNREFERENCED_GENERATED_NODES_SKIPPED');
  });

  it.each([
    ['source_node_id', 'source_nodes'],
    ['source_member_id', 'source_members'],
    ['source_surface_id', 'source_surfaces'],
  ] as const)('rejects duplicate %s values with their source path', async (idKey, collection) => {
    const calc = readCalcObject();
    calc.model.traceability[collection].push({ ...calc.model.traceability[collection][0] });

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(
      new RegExp(`Duplicate ${idKey}.*model\\.traceability\\.${collection}`),
    );
    expect(doc.allDataList).toHaveLength(0);
  });

  it('rejects duplicate model element tags before resolving metadata', async () => {
    const calc = readCalcObject();
    calc.model.elements.push({ ...calc.model.elements[0] });

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(/Duplicate element tag.*model\.elements/);
    expect(doc.allDataList).toHaveLength(0);
  });

  it('rejects generated element tags assigned to multiple traceability origins', async () => {
    const calc = readCalcObject();
    calc.model.traceability.source_members[1].generated_element_chain = [
      calc.model.traceability.source_members[0].generated_element_chain[0],
    ];

    await expect(deserializeCalcYaml(stringify(calc), { mode: 'generated' })).rejects.toThrow(
      /Duplicate generated element origin tag.*already assigned/,
    );
    expect(doc.allDataList).toHaveLength(0);
  });

  it.each([
    ['supports', {}],
    ['nodal_masses', 'invalid'],
    ['constraints', 1],
  ])('distinguishes missing optional model.%s from an invalid value', async (field, invalid) => {
    const calc = readCalcObject();
    calc.model[field] = invalid;

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(new RegExp(`model\\.${field}.*expected array`));
    expect(doc.allDataList).toHaveLength(0);
  });

  it('rejects an invalid optional property-table record', async () => {
    const calc = readCalcObject();
    calc.model.materials = [];

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(/model\.materials.*expected object/);
    expect(doc.allDataList).toHaveLength(0);
  });

  it('rejects an invalid optional generated_element_chain instead of treating it as absent', async () => {
    const calc = readCalcObject();
    calc.model.traceability.source_members[0].generated_element_chain = {};

    await expect(deserializeCalcYaml(stringify(calc))).rejects.toThrow(
      /source_members\[0\]\.generated_element_chain.*expected ID array/,
    );
    expect(doc.allDataList).toHaveLength(0);
  });

  it('clears import metadata when the document is edited after import', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    expect(doc.importMetadata).not.toBeNull();

    doc.add(new Node(new Point3D(9999, 0, 2800)));

    expect(doc.importMetadata).toBeNull();
  });

  it('preserves import metadata and emits no model event for no-op transactions', async () => {
    await deserializeCalcYaml(readSample('Test0202_calc.yaml'));
    const metadata = doc.importMetadata;
    const events: string[] = [];
    const unsubscribe = doc.subscribe((event) => events.push(event.kind));

    doc.update(() => {});
    doc.showAllLayers();

    unsubscribe();
    expect(doc.importMetadata).toBe(metadata);
    expect(events).toEqual([]);
  });
});
