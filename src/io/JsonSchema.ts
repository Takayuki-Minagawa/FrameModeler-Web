import { FloorDirection } from '../data/Floor';
import type {
  ImportPropertyTable,
  ImportSourceElementInfo,
  ImportSourceNodeInfo,
  ImportSummary,
} from '../data/ImportMetadata';
import type { SpringComponent } from '../data/Spring';
import type { DofVector6, StructuralDof } from '../data/StructuralDof';
import type { NumberCategory } from '../data/typeRegistry';
import { validateDocumentDataCollections } from './DocumentDataCodecRegistry';
import {
  asFiniteNumber,
  asId,
  asRecord,
  asString,
  cloneJsonRecord,
  optionalArray,
  optionalBoolean,
  optionalIdArray,
  optionalString,
  optionalStringArray,
  requiredArray,
  type UnknownRecord,
} from './JsonValueValidation';

export const JSON_SCHEMA_VERSION = 2 as const;
export type JsonSchemaSourceVersion = 0 | 1 | typeof JSON_SCHEMA_VERSION;

export interface JsonNodeMass {
  values: DofVector6;
  translationalUnit: string;
  rotationalUnit: string;
}

export interface JsonNode {
  number: number;
  pos: { x: number; y: number; z: number };
  mass?: JsonNodeMass;
}

export interface JsonMember {
  number: number;
  nodeI: number;
  nodeJ: number;
  section?: string;
  isNodeReverse?: boolean;
}

export interface JsonTruss extends JsonMember {
  material?: string;
  area: number;
  areaUnit: string;
  elasticModulus?: number;
  stressUnit: string;
}

export interface JsonSpring extends JsonMember {
  components: SpringComponent[];
  orientX?: { x: number; y: number; z: number };
  orientY?: { x: number; y: number; z: number };
  shearDistance?: [number, number];
  note?: string;
}

export interface JsonPlane {
  number: number;
  nodes: number[];
  section?: string;
}

export interface JsonFloor extends JsonPlane {
  weight: number;
  direction: FloorDirection;
}

export interface JsonWall extends JsonPlane {
  weight: number;
}

export interface JsonSupport {
  number: number;
  node: number;
  fixedDofs: StructuralDof[];
}

export interface JsonConstraintTerm {
  node: number;
  dof: StructuralDof;
  coefficient: number;
}

export interface JsonConstraint {
  number: number;
  kind: 'equalDOF';
  slave: { node: number; dof: StructuralDof };
  terms: JsonConstraintTerm[];
}

/** 未知optional fieldをmigration/round-tripで落とさない。 */
export interface JsonLayer extends Record<string, unknown> {
  id?: string;
  name: string;
  posZ: number;
  visible?: boolean;
  locked?: boolean;
}

export interface JsonDataCollections {
  nodes: JsonNode[];
  beams: JsonMember[];
  pillars: JsonMember[];
  trusses: JsonTruss[];
  springs: JsonSpring[];
  floors: JsonFloor[];
  walls: JsonWall[];
  bearWalls: JsonPlane[];
  supports: JsonSupport[];
  constraints: JsonConstraint[];
}

export interface JsonDataReference {
  category: NumberCategory;
  number: number;
}

export interface JsonSourceNodeMapping {
  data: JsonDataReference;
  values: ImportSourceNodeInfo[];
}

export interface JsonSourceElementMapping {
  data: JsonDataReference;
  values: ImportSourceElementInfo[];
}

export interface JsonImportMetadata {
  summary: ImportSummary;
  sourceNodes: JsonSourceNodeMapping[];
  sourceElements: JsonSourceElementMapping[];
  materials: ImportPropertyTable;
  sections: ImportPropertyTable;
}

export interface JsonDocument extends JsonDataCollections {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  layers: JsonLayer[];
  importMetadata?: JsonImportMetadata;
}

export interface ValidatedJsonDocument {
  sourceVersion: JsonSchemaSourceVersion;
  model: Omit<JsonDocument, 'schemaVersion'>;
}

/** JSON textの構文解析だけを行う。 */
export function parseJsonText(jsonString: string): unknown {
  try {
    return JSON.parse(jsonString) as unknown;
  } catch (error) {
    throw new Error('Invalid JSON document: ' + (error as Error).message);
  }
}

/** legacy v0/v1とv2を検証し、全DocumentData collectionをv2形へ正規化する。 */
export function validateJsonSchema(value: unknown): ValidatedJsonDocument {
  const root = asRecord(value, 'JSON document');
  const sourceVersion = readSourceVersion(root);
  const strictV2 = sourceVersion === JSON_SCHEMA_VERSION;
  const collections = validateDocumentDataCollections(root, { strictV2 });
  const layers = (strictV2 ? requiredArray(root.layers, 'layers') : optionalArray(root.layers, 'layers')).map(
    (raw, index) => validateLayer(raw, index, strictV2),
  );
  const importMetadata =
    root.importMetadata === undefined
      ? undefined
      : validateJsonImportMetadata(root.importMetadata, 'importMetadata', { allowLegacyCounts: sourceVersion < 2 });

  const layerElevations = new Set<number>();
  const layerIds = new Set<string>();
  layers.forEach((layer, index) => {
    if (layerElevations.has(layer.posZ)) {
      throw new Error(`Invalid layers[${index}].posZ: duplicate layer elevation ${layer.posZ}`);
    }
    layerElevations.add(layer.posZ);
    if (layer.id !== undefined) {
      if (layerIds.has(layer.id)) {
        throw new Error(`Invalid layers[${index}].id: duplicate layer id '${layer.id}'`);
      }
      layerIds.add(layer.id);
    }
  });

  return {
    sourceVersion,
    model: { ...collections, layers, importMetadata },
  };
}

/** v0/v1をv2へ移行する。一時選択状態は各codecのvalidation時に破棄済み。 */
export function migrateJsonSchema(validated: ValidatedJsonDocument): JsonDocument {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    ...validated.model,
    layers: migrateLayers(validated.model.layers),
  };
}

export function parseJsonDocument(jsonString: string): JsonDocument {
  return migrateJsonSchema(validateJsonSchema(parseJsonText(jsonString)));
}

function readSourceVersion(root: UnknownRecord): JsonSchemaSourceVersion {
  if (root.schemaVersion === undefined) return 0;
  const version = asId(root.schemaVersion, 'schemaVersion');
  if (version !== 1 && version !== JSON_SCHEMA_VERSION) {
    throw new Error(`Unsupported JSON schemaVersion: ${version}`);
  }
  return version;
}

function validateLayer(raw: unknown, index: number, strictV2: boolean): JsonLayer {
  const path = `layers[${index}]`;
  const row = asRecord(raw, path);
  const cloned = cloneJsonRecord(row, path);
  const id = optionalString(row.id, `${path}.id`);
  const visible = optionalBoolean(row.visible, `${path}.visible`);
  const locked = optionalBoolean(row.locked, `${path}.locked`);
  if (strictV2 && (!id || row.name === undefined || visible === undefined || locked === undefined)) {
    throw new Error(`Invalid ${path}: schema v2 requires non-empty id, name, visible, and locked fields`);
  }
  return {
    ...cloned,
    id,
    name: optionalString(row.name, `${path}.name`) ?? '',
    posZ: asFiniteNumber(row.posZ, `${path}.posZ`),
    visible,
    locked,
  };
}

function migrateLayers(layers: ReadonlyArray<JsonLayer>): JsonLayer[] {
  const usedIds = new Set(layers.flatMap((layer) => (layer.id ? [layer.id] : [])));
  return layers.map((layer, index) => {
    let id = layer.id;
    if (!id) {
      id = `layer-migrated-${index}`;
      let suffix = 1;
      while (usedIds.has(id)) id = `layer-migrated-${index}-${suffix++}`;
      usedIds.add(id);
    }
    return {
      ...layer,
      id,
      visible: layer.visible ?? true,
      locked: layer.locked ?? false,
    };
  });
}

/** serializer側からも利用するmetadata正規化・検証。 */
export function validateJsonImportMetadata(
  value: unknown,
  path: string = 'importMetadata',
  options: { allowLegacyCounts?: boolean } = {},
): JsonImportMetadata {
  const row = asRecord(value, path);
  const summary = validateImportSummary(row.summary, `${path}.summary`, options.allowLegacyCounts ?? false);
  const sourceNodes = requiredArray(row.sourceNodes, `${path}.sourceNodes`).map((item, index) =>
    validateSourceNodeMapping(item, index, `${path}.sourceNodes`),
  );
  const sourceElements = requiredArray(row.sourceElements, `${path}.sourceElements`).map((item, index) =>
    validateSourceElementMapping(item, index, `${path}.sourceElements`),
  );
  assertUniqueDataReferences(sourceNodes, `${path}.sourceNodes`);
  assertUniqueDataReferences(sourceElements, `${path}.sourceElements`);
  return {
    summary,
    sourceNodes,
    sourceElements,
    materials: validatePropertyTable(row.materials, `${path}.materials`),
    sections: validatePropertyTable(row.sections, `${path}.sections`),
  };
}

function validateImportSummary(value: unknown, path: string, allowLegacyCounts: boolean): ImportSummary {
  const row = asRecord(value, path);
  const warnings = requiredArray(row.warnings, `${path}.warnings`).map((item, index) => {
    const itemPath = `${path}.warnings[${index}]`;
    const warning = asRecord(item, itemPath);
    return {
      code: asString(warning.code, `${itemPath}.code`),
      message: asString(warning.message, `${itemPath}.message`),
      path: optionalString(warning.path, `${itemPath}.path`),
    };
  });
  const sourceIdMap = requiredArray(row.sourceIdMap, `${path}.sourceIdMap`).map((item, index) => {
    const itemPath = `${path}.sourceIdMap[${index}]`;
    const mapRow = asRecord(item, itemPath);
    return {
      sourceId: asString(mapRow.sourceId, `${itemPath}.sourceId`),
      appNumber: asId(mapRow.appNumber, `${itemPath}.appNumber`),
      kind: validateCategory(mapRow.kind, `${itemPath}.kind`),
      type: asString(mapRow.type, `${itemPath}.type`),
      detail: optionalString(mapRow.detail, `${itemPath}.detail`),
    };
  });

  return {
    nodes: asId(row.nodes, `${path}.nodes`),
    beams: asId(row.beams, `${path}.beams`),
    pillars: asId(row.pillars, `${path}.pillars`),
    trusses: readCurrentCount(row, 'trusses', path, allowLegacyCounts),
    springs: readCurrentCount(row, 'springs', path, allowLegacyCounts),
    floors: asId(row.floors, `${path}.floors`),
    walls: asId(row.walls, `${path}.walls`),
    bearWalls: asId(row.bearWalls, `${path}.bearWalls`),
    supports: readCurrentCount(row, 'supports', path, allowLegacyCounts),
    constraints: readCurrentCount(row, 'constraints', path, allowLegacyCounts),
    layers: asId(row.layers, `${path}.layers`),
    format: asString(row.format, `${path}.format`),
    importMode: optionalString(row.importMode, `${path}.importMode`),
    modelName: asString(row.modelName, `${path}.modelName`),
    sourceJson: optionalString(row.sourceJson, `${path}.sourceJson`),
    analysisProfile: optionalString(row.analysisProfile, `${path}.analysisProfile`),
    units: validateStringTable(row.units, `${path}.units`),
    warnings,
    sourceIdMap,
    materials: validatePropertyTable(row.materials, `${path}.materials`),
    sections: validatePropertyTable(row.sections, `${path}.sections`),
  };
}

function readCurrentCount(row: UnknownRecord, key: string, path: string, allowLegacy: boolean): number {
  if (row[key] === undefined && allowLegacy) return 0;
  return asId(row[key], `${path}.${key}`);
}

function validateSourceNodeMapping(value: unknown, index: number, collectionPath: string): JsonSourceNodeMapping {
  const path = `${collectionPath}[${index}]`;
  const row = asRecord(value, path);
  const data = validateDataReference(row.data, `${path}.data`);
  if (data.category !== 'node') {
    throw new Error(`Invalid ${path}.data.category: source node mapping must reference a node`);
  }
  const values = requiredArray(row.values, `${path}.values`).map((item, valueIndex) => {
    const valuePath = `${path}.values[${valueIndex}]`;
    const info = asRecord(item, valuePath);
    let coord: [number, number, number] | undefined;
    if (info.coord !== undefined) {
      if (!Array.isArray(info.coord) || info.coord.length !== 3) {
        throw new Error(`Invalid ${valuePath}.coord: expected [x, y, z]`);
      }
      coord = [
        asFiniteNumber(info.coord[0], `${valuePath}.coord[0]`),
        asFiniteNumber(info.coord[1], `${valuePath}.coord[1]`),
        asFiniteNumber(info.coord[2], `${valuePath}.coord[2]`),
      ];
    }
    return {
      sourceId: asString(info.sourceId, `${valuePath}.sourceId`),
      tag: info.tag === undefined ? undefined : asId(info.tag, `${valuePath}.tag`),
      coord,
    };
  });
  return { data, values };
}

function validateSourceElementMapping(value: unknown, index: number, collectionPath: string): JsonSourceElementMapping {
  const path = `${collectionPath}[${index}]`;
  const row = asRecord(value, path);
  const data = validateDataReference(row.data, `${path}.data`);
  if (data.category === 'node') {
    throw new Error(`Invalid ${path}.data.category: source element mapping cannot reference a node`);
  }
  const values = requiredArray(row.values, `${path}.values`).map((item, valueIndex) => {
    const valuePath = `${path}.values[${valueIndex}]`;
    const info = asRecord(item, valuePath);
    return {
      sourceId: asString(info.sourceId, `${valuePath}.sourceId`),
      sourceType: asString(info.sourceType, `${valuePath}.sourceType`),
      sourceRef: optionalString(info.sourceRef, `${valuePath}.sourceRef`),
      elementTags: optionalIdArray(info.elementTags, `${valuePath}.elementTags`),
      nodeSourceIds: optionalStringArray(info.nodeSourceIds, `${valuePath}.nodeSourceIds`),
      section: optionalString(info.section, `${valuePath}.section`),
      material: optionalString(info.material, `${valuePath}.material`),
      notes: optionalStringArray(info.notes, `${valuePath}.notes`),
    };
  });
  return { data, values };
}

function validateDataReference(value: unknown, path: string): JsonDataReference {
  const row = asRecord(value, path);
  return {
    category: validateCategory(row.category, `${path}.category`),
    number: asId(row.number, `${path}.number`),
  };
}

function validateCategory(value: unknown, path: string): NumberCategory {
  if (value !== 'node' && value !== 'member' && value !== 'plane' && value !== 'constraint') {
    throw new Error(`Invalid ${path}: expected 'node', 'member', 'plane', or 'constraint'`);
  }
  return value;
}

function assertUniqueDataReferences(rows: ReadonlyArray<{ data: JsonDataReference }>, path: string): void {
  const used = new Set<string>();
  rows.forEach((row, index) => {
    const key = `${row.data.category}:${row.data.number}`;
    if (used.has(key)) throw new Error(`Invalid ${path}[${index}].data: duplicate reference ${key}`);
    used.add(key);
  });
}

function validateStringTable(value: unknown, path: string): Record<string, string> {
  const row = asRecord(value, path);
  return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, asString(item, `${path}.${key}`)]));
}

function validatePropertyTable(value: unknown, path: string): ImportPropertyTable {
  const row = asRecord(value, path);
  const result: ImportPropertyTable = {};
  for (const [key, item] of Object.entries(row)) {
    result[key] = cloneJsonRecord(asRecord(item, `${path}.${key}`), `${path}.${key}`);
  }
  return result;
}
