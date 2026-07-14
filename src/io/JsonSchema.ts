import { FloorDirection } from '../data/Floor';
import type {
  ImportPropertyTable,
  ImportSourceElementInfo,
  ImportSourceNodeInfo,
  ImportSummary,
} from '../data/ImportMetadata';
import type { NumberCategory } from '../data/typeRegistry';

type UnknownRecord = Record<string, unknown>;

export const JSON_SCHEMA_VERSION = 1 as const;

export interface JsonNode {
  number: number;
  pos: { x: number; y: number; z: number };
}

export interface JsonMember {
  number: number;
  nodeI: number;
  nodeJ: number;
  section?: string;
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

export interface JsonLayer {
  name: string;
  posZ: number;
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

export interface JsonDocument {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  nodes: JsonNode[];
  beams: JsonMember[];
  pillars: JsonMember[];
  floors: JsonFloor[];
  walls: JsonWall[];
  bearWalls: JsonPlane[];
  layers: JsonLayer[];
  importMetadata?: JsonImportMetadata;
}

interface ValidatedJsonDocument {
  sourceVersion: 0 | typeof JSON_SCHEMA_VERSION;
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

/** legacy v0 / v1 の型・ID・一意性を検証し、まだ移行は行わない。 */
export function validateJsonSchema(value: unknown): ValidatedJsonDocument {
  const root = asRecord(value, 'JSON document');
  const sourceVersion = readSourceVersion(root);

  const nodes = requiredArray(root.nodes, 'nodes').map(validateNode);
  const beams = optionalArray(root.beams, 'beams').map((raw, index) => validateMember(raw, index, 'beams'));
  const pillars = optionalArray(root.pillars, 'pillars').map((raw, index) => validateMember(raw, index, 'pillars'));
  const floors = optionalArray(root.floors, 'floors').map(validateFloor);
  const walls = optionalArray(root.walls, 'walls').map(validateWall);
  const bearWalls = optionalArray(root.bearWalls, 'bearWalls').map((raw, index) =>
    validatePlane(raw, index, 'bearWalls'),
  );
  const layers = optionalArray(root.layers, 'layers').map(validateLayer);
  const importMetadata =
    root.importMetadata === undefined ? undefined : validateJsonImportMetadata(root.importMetadata, 'importMetadata');

  assertUniqueNumbers(nodes, 'node');
  assertUniqueNumbers([...beams, ...pillars], 'member');
  assertUniqueNumbers([...bearWalls, ...walls, ...floors], 'plane');
  const layerElevations = new Set<number>();
  layers.forEach((layer, index) => {
    if (layerElevations.has(layer.posZ)) {
      throw new Error(`Invalid layers[${index}].posZ: duplicate layer elevation ${layer.posZ}`);
    }
    layerElevations.add(layer.posZ);
  });

  return {
    sourceVersion,
    model: { nodes, beams, pillars, floors, walls, bearWalls, layers, importMetadata },
  };
}

/** v0は一時UI状態を捨ててv1へ正規化する。 */
export function migrateJsonSchema(validated: ValidatedJsonDocument): JsonDocument {
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    ...validated.model,
  };
}

/** parse → validate → migrate の公開入口。 */
export function parseJsonDocument(jsonString: string): JsonDocument {
  return migrateJsonSchema(validateJsonSchema(parseJsonText(jsonString)));
}

function readSourceVersion(root: UnknownRecord): 0 | typeof JSON_SCHEMA_VERSION {
  if (root.schemaVersion === undefined) return 0;
  const version = asId(root.schemaVersion, 'schemaVersion');
  if (version !== JSON_SCHEMA_VERSION) {
    throw new Error(`Unsupported JSON schemaVersion: ${version}`);
  }
  return JSON_SCHEMA_VERSION;
}

function validateNode(raw: unknown, index: number): JsonNode {
  const path = `node[${index}]`;
  const row = asRecord(raw, path);
  validateLegacySelection(row.select, `${path}.select`);
  const pos = asRecord(row.pos, `${path}.pos`);
  return {
    number: asId(row.number, `${path}.number`),
    pos: {
      x: asFiniteNumber(pos.x, `${path}.pos.x`),
      y: asFiniteNumber(pos.y, `${path}.pos.y`),
      z: asFiniteNumber(pos.z, `${path}.pos.z`),
    },
  };
}

function validateMember(raw: unknown, index: number, collection: 'beams' | 'pillars'): JsonMember {
  const path = `${collection}[${index}]`;
  const row = asRecord(raw, path);
  validateLegacySelection(row.select, `${path}.select`);
  return {
    number: asId(row.number, `${path}.number`),
    nodeI: asId(row.nodeI, `${path}.nodeI`),
    nodeJ: asId(row.nodeJ, `${path}.nodeJ`),
    section: optionalString(row.section, `${path}.section`),
  };
}

function validatePlane(raw: unknown, index: number, collection: 'floors' | 'walls' | 'bearWalls'): JsonPlane {
  const path = `${collection}[${index}]`;
  const row = asRecord(raw, path);
  validateLegacySelection(row.select, `${path}.select`);
  return {
    number: asId(row.number, `${path}.number`),
    nodes: asIdArray(row.nodes, `${path}.nodes`),
    section: optionalString(row.section, `${path}.section`),
  };
}

function validateFloor(raw: unknown, index: number): JsonFloor {
  const path = `floors[${index}]`;
  const row = asRecord(raw, path);
  const plane = validatePlane(row, index, 'floors');
  const direction = optionalString(row.direction, `${path}.direction`) ?? FloorDirection.X;
  return {
    ...plane,
    weight: optionalFiniteNumber(row.weight, `${path}.weight`) ?? 0,
    // v0の不正な文字列値は従来互換でXへ正規化する。
    direction: (Object.values(FloorDirection) as string[]).includes(direction)
      ? (direction as FloorDirection)
      : FloorDirection.X,
  };
}

function validateWall(raw: unknown, index: number): JsonWall {
  const path = `walls[${index}]`;
  const row = asRecord(raw, path);
  return {
    ...validatePlane(row, index, 'walls'),
    weight: optionalFiniteNumber(row.weight, `${path}.weight`) ?? 0,
  };
}

function validateLayer(raw: unknown, index: number): JsonLayer {
  const path = `layers[${index}]`;
  const row = asRecord(raw, path);
  return {
    name: optionalString(row.name, `${path}.name`) ?? '',
    posZ: asFiniteNumber(row.posZ, `${path}.posZ`),
  };
}

/** serializer側からも利用するmetadata正規化・検証。 */
export function validateJsonImportMetadata(value: unknown, path: string = 'importMetadata'): JsonImportMetadata {
  const row = asRecord(value, path);
  const summary = validateImportSummary(row.summary, `${path}.summary`);
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

function validateImportSummary(value: unknown, path: string): ImportSummary {
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
    const kind = validateCategory(mapRow.kind, `${itemPath}.kind`);
    return {
      sourceId: asString(mapRow.sourceId, `${itemPath}.sourceId`),
      appNumber: asId(mapRow.appNumber, `${itemPath}.appNumber`),
      kind,
      type: asString(mapRow.type, `${itemPath}.type`),
      detail: optionalString(mapRow.detail, `${itemPath}.detail`),
    };
  });

  return {
    nodes: asId(row.nodes, `${path}.nodes`),
    beams: asId(row.beams, `${path}.beams`),
    pillars: asId(row.pillars, `${path}.pillars`),
    floors: asId(row.floors, `${path}.floors`),
    walls: asId(row.walls, `${path}.walls`),
    bearWalls: asId(row.bearWalls, `${path}.bearWalls`),
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
  if (value !== 'node' && value !== 'member' && value !== 'plane') {
    throw new Error(`Invalid ${path}: expected 'node', 'member', or 'plane'`);
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
    const property = asRecord(item, `${path}.${key}`);
    result[key] = cloneJsonRecord(property, `${path}.${key}`);
  }
  return result;
}

function cloneJsonRecord(value: UnknownRecord, path: string): Record<string, unknown> {
  const stack = new WeakSet<object>();
  return cloneJsonValue(value, path, stack) as Record<string, unknown>;
}

function cloneJsonValue(value: unknown, path: string, stack: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return asFiniteNumber(value, path);
  if (typeof value !== 'object') throw new Error(`Invalid ${path}: expected JSON-compatible value`);
  if (stack.has(value)) throw new Error(`Invalid ${path}: circular value`);
  stack.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`, stack));
  } else {
    result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item, `${path}.${key}`, stack)]),
    );
  }
  stack.delete(value);
  return result;
}

function assertUniqueNumbers(rows: ReadonlyArray<{ number: number }>, label: string): void {
  const used = new Set<number>();
  rows.forEach((row, index) => {
    if (used.has(row.number)) {
      throw new Error(`Duplicate ${label} number at ${label}[${index}]: ${row.number}`);
    }
    used.add(row.number);
  });
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${path}: expected object`);
  }
  return value as UnknownRecord;
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (value === undefined) throw new Error(`Invalid JSON field '${path}': required array`);
  if (!Array.isArray(value)) throw new Error(`Invalid JSON field '${path}': expected array`);
  return value;
}

function optionalArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid JSON field '${path}': expected array`);
  return value;
}

function asFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${path}: expected finite number`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return asFiniteNumber(value, path);
}

function asId(value: unknown, path: string): number {
  const number = asFiniteNumber(value, path);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Invalid ${path}: expected a non-negative integer`);
  }
  return number;
}

function asIdArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${path}: expected number array`);
  return value.map((item, index) => asId(item, `${path}[${index}]`));
}

function optionalIdArray(value: unknown, path: string): number[] | undefined {
  if (value === undefined) return undefined;
  return asIdArray(value, path);
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`Invalid ${path}: expected string array`);
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${path}: expected string`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, path);
}

function validateLegacySelection(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`Invalid ${path}: expected boolean`);
  }
}
