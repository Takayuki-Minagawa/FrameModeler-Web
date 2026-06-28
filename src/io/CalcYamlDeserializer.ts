import { Beam } from '../data/Beam';
import { Document } from '../data/Document';
import type { DocumentData } from '../data/DocumentData';
import { Floor, FloorDirection } from '../data/Floor';
import type {
  ImportMetadata,
  ImportPropertyTable,
  ImportSourceElementInfo,
  ImportSourceNodeInfo,
  ImportSummary,
  ImportWarning,
} from '../data/ImportMetadata';
import { Node } from '../data/Node';
import { Point3D } from '../math/Point3D';
import { Layer } from '../ui/Layer';

type UnknownRecord = Record<string, unknown>;
export type CalcYamlImportMode = 'source' | 'generated';

export interface CalcYamlDeserializeOptions {
  mode?: CalcYamlImportMode;
}

const MIN_GEOMETRY_LENGTH = 1e-9;

interface BuildContext {
  warnings: ImportWarning[];
  nodesByCoord: Map<string, Node>;
  sourceNodeById: Map<string, Node>;
  sourceNodeInfo: Map<DocumentData, ImportSourceNodeInfo[]>;
  sourceElementInfo: Map<DocumentData, ImportSourceElementInfo[]>;
  sourceIdMapObjects: Array<{ sourceId: string; data: DocumentData; kind: 'node' | 'member' | 'plane'; type: string; detail?: string }>;
  elementsByTag: Map<number, UnknownRecord>;
  materials: ImportPropertyTable;
  sections: ImportPropertyTable;
}

/** 構造解析用 YAML を既存 CAD Document へ変換して読み込む */
export async function deserializeCalcYaml(yamlString: string, options: CalcYamlDeserializeOptions = {}): Promise<ImportSummary> {
  const mode = options.mode ?? 'source';
  const { parse } = await import('yaml');
  let parsedUnknown: unknown;
  try {
    parsedUnknown = parse(yamlString, { maxAliasCount: 1000 });
  } catch (e) {
    throw new Error('Invalid YAML document: ' + (e as Error).message);
  }

  const root = asRecord(parsedUnknown, 'document');
  const schemaVersion = asVersionString(root.schema_version, 'schema_version');
  if (schemaVersion !== '1') {
    throw new Error(`Unsupported calc YAML schema_version: ${schemaVersion}`);
  }

  const units = readStringTable(root.units, 'units');
  if (units.length !== 'mm') {
    throw new Error(`Unsupported calc YAML length unit: ${units.length || '(missing)'}`);
  }

  const model = asRecord(root.model, 'model');
  const traceability = readTraceability(model, mode);

  const ctx: BuildContext = {
    warnings: [],
    nodesByCoord: new Map(),
    sourceNodeById: new Map(),
    sourceNodeInfo: new Map(),
    sourceElementInfo: new Map(),
    sourceIdMapObjects: [],
    elementsByTag: mode === 'source' ? indexElements(readOptionalArray(model.elements, 'model.elements')) : new Map(),
    materials: toPropertyTable(model.materials, 'model.materials'),
    sections: toPropertyTable(model.sections, 'model.sections'),
  };

  const allData: DocumentData[] = [];
  let layers: Layer[];

  if (mode === 'generated') {
    const referencedNodeTags = collectGeneratedReferencedNodeTags(model);
    const generatedNodes = buildGeneratedNodes(model, referencedNodeTags, allData, ctx);
    layers = buildGeneratedLayers(generatedNodes, traceability);
    buildGeneratedElements(model, generatedNodes, allData, ctx, traceability);
    collectUnsupportedWarnings(model, ctx.warnings, { springsImported: true });
  } else {
    const sourceLevel = asRecord(traceability.source_level, 'model.traceability.source_level');
    const layerZ = asNumber(sourceLevel.z, 'model.traceability.source_level.z');
    const layerName = optString(sourceLevel.level_id) ?? 'YAML Level';
    layers = [new Layer(layerZ, layerName)];

    buildSourceNodes(traceability, layerZ, allData, ctx);
    buildSourceMembers(traceability, allData, ctx);
    buildSourceFloors(traceability, layerZ, allData, ctx);
    collectUnsupportedWarnings(model, ctx.warnings);
  }

  const doc = Document.instance;
  doc.bulkLoad(allData, layers);

  const summary = buildSummary(
    model,
    units,
    doc,
    ctx,
    mode,
  );
  const metadata: ImportMetadata = {
    summary,
    sourceNodes: ctx.sourceNodeInfo,
    sourceElements: ctx.sourceElementInfo,
    materials: ctx.materials,
    sections: ctx.sections,
  };
  doc.setImportMetadata(metadata);

  return summary;
}

function readTraceability(model: UnknownRecord, mode: CalcYamlImportMode): UnknownRecord {
  if (mode === 'source') {
    return asRecord(model.traceability, 'model.traceability');
  }
  if (model.traceability === undefined) {
    return {};
  }
  return asRecord(model.traceability, 'model.traceability');
}

function collectGeneratedReferencedNodeTags(model: UnknownRecord): Set<number> {
  const referenced = new Set<number>();
  const elements = asArray(model.elements, 'model.elements');
  for (let i = 0; i < elements.length; i++) {
    const raw = asRecord(elements[i], `model.elements[${i}]`);
    const type = asString(raw.type, `model.elements[${i}].type`);
    if (!isGeneratedLineElementType(type)) continue;
    referenced.add(asNumber(raw.node_i, `model.elements[${i}].node_i`));
    referenced.add(asNumber(raw.node_j, `model.elements[${i}].node_j`));
  }
  if (referenced.size === 0) {
    throw new Error('model.elements must contain at least one supported generated line element');
  }
  return referenced;
}

function buildGeneratedNodes(
  model: UnknownRecord,
  referencedNodeTags: Set<number>,
  allData: DocumentData[],
  ctx: BuildContext,
): Map<number, Node> {
  const rawNodes = asArray(model.nodes, 'model.nodes');
  if (rawNodes.length === 0) {
    throw new Error('model.nodes must contain at least one generated node');
  }
  const nodesByTag = new Map<number, Node>();
  const usedCoords = new Map<string, string[]>();
  let skippedNodeCount = 0;
  for (let i = 0; i < rawNodes.length; i++) {
    const raw = asRecord(rawNodes[i], `model.nodes[${i}]`);
    const tag = asNumber(raw.tag, `model.nodes[${i}].tag`);
    if (nodesByTag.has(tag)) {
      throw new Error(`Duplicate generated node tag: ${tag}`);
    }
    const coord = new Point3D(
      asNumber(raw.x, `model.nodes[${i}].x`),
      asNumber(raw.y, `model.nodes[${i}].y`),
      asNumber(raw.z, `model.nodes[${i}].z`),
    );
    if (!referencedNodeTags.has(tag)) {
      skippedNodeCount++;
      continue;
    }
    const node = new Node(coord);
    nodesByTag.set(tag, node);
    const key = coordKey(coord);
    usedCoords.set(key, [...(usedCoords.get(key) ?? []), String(tag)]);
    allData.push(node);
    addSourceNodeInfo(ctx, node, { sourceId: String(tag), tag, coord: [coord.x, coord.y, coord.z] });
    addSourceIdMapObject(ctx, {
      sourceId: String(tag),
      data: node,
      kind: 'node',
      type: 'Generated Node',
    });
  }
  if (nodesByTag.size === 0) {
    throw new Error('model.nodes does not contain any nodes referenced by supported generated line elements');
  }
  if (skippedNodeCount > 0) {
    ctx.warnings.push({
      code: 'UNREFERENCED_GENERATED_NODES_SKIPPED',
      message: `${skippedNodeCount} unreferenced generated nodes were skipped.`,
      path: 'model.nodes',
    });
  }
  const duplicateCoordGroups = [...usedCoords.values()].filter((tags) => tags.length > 1);
  if (duplicateCoordGroups.length > 0) {
    ctx.warnings.push({
      code: 'DUPLICATE_GENERATED_NODE_COORDS',
      message: `${duplicateCoordGroups.length} generated node coordinate groups contain multiple tags and were kept separate.`,
      path: 'model.nodes',
    });
  }
  return nodesByTag;
}

function buildGeneratedLayers(nodesByTag: Map<number, Node>, traceability: UnknownRecord): Layer[] {
  const uniqueZ = [...new Set([...nodesByTag.values()].map((node) => node.pos.z))].sort((a, b) => a - b);
  const sourceLevel = asOptionalRecord(traceability.source_level);
  const sourceLevelZ = typeof sourceLevel.z === 'number' ? sourceLevel.z : undefined;
  const sourceLevelName = optString(sourceLevel.level_id);
  return uniqueZ.map((z) => new Layer(
    z,
    sourceLevelName && sourceLevelZ === z ? sourceLevelName : `Generated Z=${z}`,
  ));
}

function buildGeneratedElements(
  model: UnknownRecord,
  nodesByTag: Map<number, Node>,
  allData: DocumentData[],
  ctx: BuildContext,
  traceability: UnknownRecord,
): void {
  const originsByTag = buildGeneratedElementOrigins(traceability);
  const elements = asArray(model.elements, 'model.elements');
  const seenTags = new Set<number>();
  let importedSpringCount = 0;
  let zeroLengthSpringCount = 0;
  for (let i = 0; i < elements.length; i++) {
    const raw = asRecord(elements[i], `model.elements[${i}]`);
    const type = asString(raw.type, `model.elements[${i}].type`);
    const tag = asNumber(raw.tag, `model.elements[${i}].tag`);
    if (seenTags.has(tag)) throw new Error(`Duplicate generated element tag: ${tag}`);
    seenTags.add(tag);

    if (!isGeneratedLineElementType(type)) {
      ctx.warnings.push({
        code: 'UNSUPPORTED_GENERATED_ELEMENT',
        message: `Skipped unsupported generated element type '${type}' (${tag})`,
        path: `model.elements[${i}]`,
      });
      continue;
    }

    const nodeITag = asNumber(raw.node_i, `model.elements[${i}].node_i`);
    const nodeJTag = asNumber(raw.node_j, `model.elements[${i}].node_j`);
    const nodeI = nodesByTag.get(nodeITag);
    const nodeJ = nodesByTag.get(nodeJTag);
    if (!nodeI || !nodeJ) {
      throw new Error(`generated element ${tag} references missing node: ${!nodeI ? nodeITag : nodeJTag}`);
    }
    const length = nodeI.pos.sub(nodeJ.pos).length;
    if (type !== 'twoNodeLink3D' && (nodeI === nodeJ || length <= MIN_GEOMETRY_LENGTH)) {
      throw new Error(`generated element ${tag} resolves to a zero-length Beam`);
    }
    if (type === 'twoNodeLink3D') {
      importedSpringCount++;
      if (nodeI === nodeJ || length <= MIN_GEOMETRY_LENGTH) zeroLengthSpringCount++;
    }

    const beam = new Beam(nodeI, nodeJ);
    beam.section = optString(raw.section_ref) ?? type;
    allData.push(beam);

    const origin = originsByTag.get(tag);
    const material = optString(raw.material_ref) ?? origin?.material;
    const notes = generatedElementNotes(type, origin);
    const info: ImportSourceElementInfo = {
      sourceId: String(tag),
      sourceType: type,
      sourceRef: origin?.sourceRef,
      elementTags: [tag],
      nodeSourceIds: [String(nodeITag), String(nodeJTag)],
      section: beam.section,
      material,
      notes,
    };
    addSourceElementInfo(ctx, beam, info);
    addSourceIdMapObject(ctx, {
      sourceId: String(tag),
      data: beam,
      kind: 'member',
      type,
      detail: [
        `section=${beam.section}`,
        material ? `material=${material}` : '',
        origin ? `source=${origin.sourceId}` : '',
      ].filter(Boolean).join(' '),
    });
  }
  if (importedSpringCount > 0) {
    ctx.warnings.push({
      code: 'SPRINGS_IMPORTED_AS_BEAM',
      message: `${importedSpringCount} twoNodeLink3D spring elements were imported as display Beams${zeroLengthSpringCount > 0 ? `, including ${zeroLengthSpringCount} zero-length springs` : ''}.`,
      path: 'model.elements',
    });
  }
}

function isGeneratedLineElementType(type: string): boolean {
  return type === 'elasticTimoshenkoBeam3D' || type === 'truss3D' || type === 'twoNodeLink3D';
}

function generatedElementNotes(
  type: string,
  origin?: { sourceId: string; sourceType: string; sourceSection?: string; material?: string },
): string[] | undefined {
  const notes: string[] = [];
  if (origin) {
    notes.push(`Generated from ${origin.sourceId} (${origin.sourceType}${origin.sourceSection ? ` section=${origin.sourceSection}` : ''}).`);
  }
  if (type === 'truss3D') {
    notes.push('Imported as Beam because no dedicated truss class exists.');
  } else if (type === 'twoNodeLink3D') {
    notes.push('Imported as Beam for generated analysis element display.');
  }
  return notes.length > 0 ? notes : undefined;
}

function buildGeneratedElementOrigins(traceability: UnknownRecord): Map<number, {
  sourceId: string;
  sourceType: string;
  sourceRef?: string;
  sourceSection?: string;
  material?: string;
}> {
  const origins = new Map<number, {
    sourceId: string;
    sourceType: string;
    sourceRef?: string;
    sourceSection?: string;
    material?: string;
  }>();
  addGeneratedOrigins(origins, optionalArray(traceability.source_members), 'source_member_id');
  addGeneratedOrigins(origins, optionalArray(traceability.source_surfaces), 'source_surface_id');
  return origins;
}

function addGeneratedOrigins(
  origins: Map<number, { sourceId: string; sourceType: string; sourceRef?: string; sourceSection?: string; material?: string }>,
  rows: unknown[],
  idKey: 'source_member_id' | 'source_surface_id',
): void {
  rows.forEach((row) => {
    if (!isRecord(row)) return;
    const sourceId = optString(row[idKey]);
    const sourceType = optString(row.source_type);
    if (!sourceId || !sourceType) return;
    const tags = readOptionalNumberArray(row.generated_element_chain) ?? [];
    const sourceSection = optString(row.source_section);
    const material = inferMaterial(sourceType, sourceSection ?? '');
    tags.forEach((tag) => {
      if (!origins.has(tag)) {
        origins.set(tag, {
          sourceId,
          sourceType,
          sourceRef: optString(row.source_ref),
          sourceSection,
          material,
        });
      }
    });
  });
}

function buildSourceNodes(traceability: UnknownRecord, layerZ: number, allData: DocumentData[], ctx: BuildContext): void {
  const sourceNodes = asArray(traceability.source_nodes, 'model.traceability.source_nodes');
  for (let i = 0; i < sourceNodes.length; i++) {
    const raw = asRecord(sourceNodes[i], `model.traceability.source_nodes[${i}]`);
    const sourceId = String(asNumber(raw.source_node_id, `model.traceability.source_nodes[${i}].source_node_id`));
    const coord = readCoord(raw.coord, `model.traceability.source_nodes[${i}].coord`);
    const node = getOrCreateNode(coord, allData, ctx);
    ctx.sourceNodeById.set(sourceId, node);
    addSourceNodeInfo(ctx, node, { sourceId, tag: Number(sourceId), coord: [coord.x, coord.y, coord.z] });
    addSourceIdMapObject(ctx, { sourceId, data: node, kind: 'node', type: 'Node' });
  }

  if (sourceNodes.length === 0) {
    ctx.warnings.push({
      code: 'NO_SOURCE_NODES',
      message: `traceability.source_nodes is empty; floor rectangles will create nodes at z=${layerZ}`,
      path: 'model.traceability.source_nodes',
    });
  }
}

function buildSourceMembers(traceability: UnknownRecord, allData: DocumentData[], ctx: BuildContext): void {
  const sourceMembers = asArray(traceability.source_members, 'model.traceability.source_members');
  for (let i = 0; i < sourceMembers.length; i++) {
    const raw = asRecord(sourceMembers[i], `model.traceability.source_members[${i}]`);
    const sourceId = asString(raw.source_member_id, `model.traceability.source_members[${i}].source_member_id`);
    const sourceType = asString(raw.source_type, `model.traceability.source_members[${i}].source_type`);
    if (sourceType !== 'beam' && sourceType !== 'hbrace') {
      ctx.warnings.push({
        code: 'UNSUPPORTED_SOURCE_MEMBER',
        message: `Skipped unsupported source member type '${sourceType}' (${sourceId})`,
        path: `model.traceability.source_members[${i}]`,
      });
      continue;
    }

    const nodeIds = readNumberArray(raw.source_nodes, `model.traceability.source_members[${i}].source_nodes`);
    if (nodeIds.length !== 2) {
      throw new Error(`source member ${sourceId} must have exactly 2 source_nodes`);
    }
    const nodeI = getSourceNode(ctx, String(nodeIds[0]), `source member ${sourceId}`);
    const nodeJ = getSourceNode(ctx, String(nodeIds[1]), `source member ${sourceId}`);
    if (nodeI === nodeJ) {
      throw new Error(`source member ${sourceId} resolves to the same CAD node at both ends`);
    }
    const beam = new Beam(nodeI, nodeJ);
    beam.section = optString(raw.source_section) ?? beam.section;
    allData.push(beam);

    const elementTags = readOptionalNumberArray(raw.generated_element_chain);
    const material = materialFromElements(ctx, elementTags) ?? inferMaterial(sourceType, beam.section);
    const info: ImportSourceElementInfo = {
      sourceId,
      sourceType,
      sourceRef: optString(raw.source_ref),
      elementTags,
      nodeSourceIds: nodeIds.map(String),
      section: beam.section,
      material,
      notes: sourceType === 'hbrace' ? ['Imported as Beam because no dedicated brace class exists.'] : undefined,
    };
    addSourceElementInfo(ctx, beam, info);
    ctx.sourceIdMapObjects.push({
      sourceId,
      data: beam,
      kind: 'member',
      type: sourceType === 'hbrace' ? 'Beam(hbrace)' : 'Beam',
      detail: `section=${beam.section}${material ? ` material=${material}` : ''}`,
    });

    if (sourceType === 'hbrace') {
      ctx.warnings.push({
        code: 'HBRACE_AS_BEAM',
        message: `${sourceId} was imported as Beam because FrameModeler-Web has no hbrace class.`,
        path: `model.traceability.source_members[${i}]`,
      });
    }
  }
}

function buildSourceFloors(traceability: UnknownRecord, layerZ: number, allData: DocumentData[], ctx: BuildContext): void {
  const sourceSurfaces = asArray(traceability.source_surfaces, 'model.traceability.source_surfaces');
  for (let i = 0; i < sourceSurfaces.length; i++) {
    const raw = asRecord(sourceSurfaces[i], `model.traceability.source_surfaces[${i}]`);
    const sourceId = asString(raw.source_surface_id, `model.traceability.source_surfaces[${i}].source_surface_id`);
    const sourceType = asString(raw.source_type, `model.traceability.source_surfaces[${i}].source_type`);
    if (sourceType !== 'floor') {
      ctx.warnings.push({
        code: 'UNSUPPORTED_SOURCE_SURFACE',
        message: `Skipped unsupported source surface type '${sourceType}' (${sourceId})`,
        path: `model.traceability.source_surfaces[${i}]`,
      });
      continue;
    }

    const rect = asRecord(raw.source_rect, `model.traceability.source_surfaces[${i}].source_rect`);
    const x1 = asNumber(rect.x1, `model.traceability.source_surfaces[${i}].source_rect.x1`);
    const y1 = asNumber(rect.y1, `model.traceability.source_surfaces[${i}].source_rect.y1`);
    const x2 = asNumber(rect.x2, `model.traceability.source_surfaces[${i}].source_rect.x2`);
    const y2 = asNumber(rect.y2, `model.traceability.source_surfaces[${i}].source_rect.y2`);
    if (Math.abs(x2 - x1) <= MIN_GEOMETRY_LENGTH || Math.abs(y2 - y1) <= MIN_GEOMETRY_LENGTH) {
      throw new Error(`source surface ${sourceId} has an invalid zero-area source_rect`);
    }

    const coords = [
      new Point3D(x1, y1, layerZ),
      new Point3D(x2, y1, layerZ),
      new Point3D(x2, y2, layerZ),
      new Point3D(x1, y2, layerZ),
    ];
    const nodes = coords.map((coord, index) => {
      const node = getOrCreateNode(coord, allData, ctx);
      const cornerSourceId = `${sourceId}.corner${index + 1}`;
      addSourceNodeInfo(ctx, node, {
        sourceId: cornerSourceId,
        coord: [coord.x, coord.y, coord.z],
      });
      addSourceIdMapObject(ctx, {
        sourceId: cornerSourceId,
        data: node,
        kind: 'node',
        type: 'Node(floor corner)',
      });
      return node;
    });
    if (new Set(nodes).size !== nodes.length) {
      throw new Error(`source surface ${sourceId} resolves to duplicate CAD nodes`);
    }

    const floor = new Floor(nodes);
    floor.section = optString(raw.source_section) ?? floor.section;
    floor.direction = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? FloorDirection.X : FloorDirection.Y;
    allData.push(floor);

    const elementTags = readOptionalNumberArray(raw.generated_element_chain);
    const material = materialFromElements(ctx, elementTags) ?? inferMaterial(sourceType, floor.section);
    addSourceElementInfo(ctx, floor, {
      sourceId,
      sourceType,
      sourceRef: optString(raw.source_ref),
      elementTags,
      section: floor.section,
      material,
      notes: generatedSections(ctx, elementTags),
    });
    ctx.sourceIdMapObjects.push({
      sourceId,
      data: floor,
      kind: 'plane',
      type: 'Floor',
      detail: `section=${floor.section}${material ? ` material=${material}` : ''}`,
    });
  }
}

function getOrCreateNode(pos: Point3D, allData: DocumentData[], ctx: BuildContext): Node {
  const key = coordKey(pos);
  const existing = ctx.nodesByCoord.get(key);
  if (existing) return existing;
  const node = new Node(pos);
  ctx.nodesByCoord.set(key, node);
  allData.push(node);
  return node;
}

function getSourceNode(ctx: BuildContext, sourceId: string, label: string): Node {
  const node = ctx.sourceNodeById.get(sourceId);
  if (!node) throw new Error(`${label} references missing source node: ${sourceId}`);
  return node;
}

function coordKey(pos: Point3D): string {
  return `${pos.x}:${pos.y}:${pos.z}`;
}

function addSourceNodeInfo(ctx: BuildContext, node: Node, info: ImportSourceNodeInfo): void {
  const list = ctx.sourceNodeInfo.get(node) ?? [];
  if (!list.some((x) => x.sourceId === info.sourceId)) list.push(info);
  ctx.sourceNodeInfo.set(node, list);
}

function addSourceElementInfo(ctx: BuildContext, data: DocumentData, info: ImportSourceElementInfo): void {
  const list = ctx.sourceElementInfo.get(data) ?? [];
  list.push(info);
  ctx.sourceElementInfo.set(data, list);
}

function addSourceIdMapObject(
  ctx: BuildContext,
  row: { sourceId: string; data: DocumentData; kind: 'node' | 'member' | 'plane'; type: string; detail?: string },
): void {
  if (ctx.sourceIdMapObjects.some((existing) => existing.sourceId === row.sourceId && existing.kind === row.kind)) return;
  ctx.sourceIdMapObjects.push(row);
}

function collectUnsupportedWarnings(
  model: UnknownRecord,
  warnings: ImportWarning[],
  options: { springsImported?: boolean } = {},
): void {
  const supports = optionalArray(model.supports);
  const nodalMasses = optionalArray(model.nodal_masses);
  const constraints = optionalArray(model.constraints);
  const elements = optionalArray(model.elements);
  const twoNodeLinks = elements.filter((raw) => isRecord(raw) && raw.type === 'twoNodeLink3D');
  if (supports.length > 0) {
    warnings.push({ code: 'SUPPORTS_NOT_IMPORTED', message: `${supports.length} supports were not imported.`, path: 'model.supports' });
  }
  if (nodalMasses.length > 0) {
    warnings.push({ code: 'NODAL_MASSES_NOT_IMPORTED', message: `${nodalMasses.length} nodal masses were not imported.`, path: 'model.nodal_masses' });
  }
  if (constraints.length > 0) {
    warnings.push({ code: 'CONSTRAINTS_NOT_IMPORTED', message: `${constraints.length} constraints were not imported.`, path: 'model.constraints' });
  }
  if (twoNodeLinks.length > 0 && !options.springsImported) {
    warnings.push({ code: 'SPRINGS_NOT_IMPORTED', message: `${twoNodeLinks.length} twoNodeLink3D spring elements were not imported.`, path: 'model.elements' });
  }
  if (Object.keys(asOptionalRecord(model.materials)).length > 0 || Object.keys(asOptionalRecord(model.sections)).length > 0) {
    warnings.push({
      code: 'PROPERTIES_SUMMARY_ONLY',
      message: 'Material and section property tables are available in import info but are not saved into the CAD JSON model.',
      path: 'model.materials/model.sections',
    });
  }
}

function buildSummary(
  model: UnknownRecord,
  units: Record<string, string>,
  doc: Document,
  ctx: BuildContext,
  mode: CalcYamlImportMode,
): ImportSummary {
  const counts = {
    nodes: doc.nodeList.length,
    beams: doc.allDataList.filter((d) => d.constructor === Beam).length,
    pillars: 0,
    floors: doc.allDataList.filter((d) => d.constructor === Floor).length,
    walls: 0,
    bearWalls: 0,
    layers: doc.layers.length,
  };
  return {
    ...counts,
    format: mode === 'generated' ? 'calc-yaml-generated' : 'calc-yaml',
    importMode: mode,
    modelName: optString(model.name) ?? '',
    sourceJson: optString(model.source_json),
    analysisProfile: optString(model.analysis_profile),
    units,
    warnings: [...ctx.warnings],
    sourceIdMap: ctx.sourceIdMapObjects.map((row) => ({
      sourceId: row.sourceId,
      appNumber: row.data.number,
      kind: row.kind,
      type: row.type,
      detail: row.detail,
    })),
    materials: ctx.materials,
    sections: ctx.sections,
  };
}

function indexElements(elements: unknown[]): Map<number, UnknownRecord> {
  const indexed = new Map<number, UnknownRecord>();
  elements.forEach((raw, i) => {
    const e = asRecord(raw, `model.elements[${i}]`);
    const tag = asNumber(e.tag, `model.elements[${i}].tag`);
    indexed.set(tag, e);
  });
  return indexed;
}

function materialFromElements(ctx: BuildContext, tags: number[] | undefined): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  const refs = new Set<string>();
  for (const tag of tags) {
    const ref = optString(ctx.elementsByTag.get(tag)?.material_ref);
    if (ref) refs.add(ref);
  }
  return refs.size === 1 ? [...refs][0] : undefined;
}

function generatedSections(ctx: BuildContext, tags: number[] | undefined): string[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  const refs = new Set<string>();
  for (const tag of tags) {
    const ref = optString(ctx.elementsByTag.get(tag)?.section_ref);
    if (ref) refs.add(ref);
  }
  return refs.size > 0 ? [`Generated section_ref: ${[...refs].join(', ')}`] : undefined;
}

function inferMaterial(sourceType: string, section: string): string | undefined {
  if (sourceType === 'floor') return 'alc';
  if (sourceType === 'beam' || sourceType === 'hbrace') return 'steel';
  if (section === 'S' || section.startsWith('ALC')) return 'alc';
  if (section === 'B' || section === 'V') return 'steel';
  return undefined;
}

function readCoord(value: unknown, label: string): Point3D {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`Invalid ${label}: expected [x, y, z]`);
  }
  return new Point3D(
    asNumber(value[0], `${label}[0]`),
    asNumber(value[1], `${label}[1]`),
    asNumber(value[2], `${label}[2]`),
  );
}

function readStringTable(value: unknown, label: string): Record<string, string> {
  const r = asRecord(value, label);
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(r)) {
    out[key] = asString(v, `${label}.${key}`);
  }
  return out;
}

function toPropertyTable(value: unknown, label: string): ImportPropertyTable {
  const r = asOptionalRecord(value);
  const out: ImportPropertyTable = {};
  for (const [key, raw] of Object.entries(r)) {
    const prop = asRecord(raw, `${label}.${key}`);
    out[key] = { ...prop };
  }
  return out;
}

function readNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected number array`);
  return value.map((x, i) => asNumber(x, `${label}[${i}]`));
}

function readOptionalNumberArray(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  return readNumberArray(value, 'generated_element_chain');
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array`);
  return value;
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readOptionalArray(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  return asArray(value, label);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`Invalid ${label}: expected object`);
  return value;
}

function asOptionalRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected finite number`);
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}: expected string`);
  return value;
}

function asVersionString(value: unknown, label: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error(`Invalid ${label}: expected string or number`);
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
