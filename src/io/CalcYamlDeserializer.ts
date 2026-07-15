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
import { ModelValidator } from '../data/ModelValidator';
import { Point3D } from '../math/Point3D';
import { Layer } from '../data/Layer';
import { Truss } from '../data/Truss';
import { Spring } from '../data/Spring';
import { Support } from '../data/Support';
import { Constraint } from '../data/Constraint';
import { ImportCommand } from '../commands/DocumentCommands';
import type { DocumentImportPlan } from './DocumentImportPlan';
import {
  isStructuralDof,
  structuralDofFromOneBasedIndex,
  type DofVector6,
  type StructuralDof,
} from '../data/StructuralDof';

type UnknownRecord = Record<string, unknown>;
export type CalcYamlImportMode = 'source' | 'generated';

export interface CalcYamlDeserializeOptions {
  mode?: CalcYamlImportMode;
}

export type CalcYamlImportPlan = DocumentImportPlan<ImportSummary>;

interface BuildContext {
  warnings: ImportWarning[];
  nodesByCoord: Map<string, Node>;
  sourceNodeById: Map<string, Node>;
  sourceNodeInfo: Map<DocumentData, ImportSourceNodeInfo[]>;
  sourceElementInfo: Map<DocumentData, ImportSourceElementInfo[]>;
  sourceIdMapObjects: Array<{
    sourceId: string;
    data: DocumentData;
    kind: 'node' | 'member' | 'plane' | 'constraint';
    type: string;
    detail?: string;
  }>;
  elementsByTag: Map<number, UnknownRecord>;
  materials: ImportPropertyTable;
  sections: ImportPropertyTable;
  units: Record<string, string>;
}

interface SummaryFields {
  modelName: string;
  sourceJson?: string;
  analysisProfile?: string;
}

/** 構造解析用 YAML を既存 CAD Document へ変換して読み込む */
export async function deserializeCalcYaml(
  yamlString: string,
  options: CalcYamlDeserializeOptions = {},
): Promise<ImportSummary> {
  const plan = await createCalcYamlImportPlan(yamlString, options);
  return Document.instance.execute(new ImportCommand('YAML読込', (document) => plan.commit(document)));
}

/** YAML parse/domain buildを完了し、Documentをまだ変更しないimport planを返す。 */
export async function createCalcYamlImportPlan(
  yamlString: string,
  options: CalcYamlDeserializeOptions = {},
): Promise<CalcYamlImportPlan> {
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
  // Summary fields are part of the import contract. Validate them before any
  // Document replacement so malformed optional metadata cannot make an import
  // fail after bulkLoad has already discarded the previous model.
  const summaryFields = readSummaryFields(model);
  const traceability = readTraceability(model, mode);
  validateTraceabilityIds(traceability, mode);
  const modelElements =
    mode === 'generated'
      ? asArray(model.elements, 'model.elements')
      : readOptionalArray(model.elements, 'model.elements');
  const elementsByTag = indexElements(modelElements);

  const ctx: BuildContext = {
    warnings: [],
    nodesByCoord: new Map(),
    sourceNodeById: new Map(),
    sourceNodeInfo: new Map(),
    sourceElementInfo: new Map(),
    sourceIdMapObjects: [],
    elementsByTag,
    materials: toPropertyTable(model.materials, 'model.materials'),
    sections: toPropertyTable(model.sections, 'model.sections'),
    units,
  };

  const allData: DocumentData[] = [];
  let layers: Layer[];

  if (mode === 'generated') {
    const referencedNodeTags = collectGeneratedReferencedNodeTags(model);
    const generatedNodes = buildGeneratedNodes(model, referencedNodeTags, allData, ctx);
    layers = buildGeneratedLayers(generatedNodes, traceability);
    buildGeneratedElements(model, generatedNodes, allData, ctx, traceability);
    applyGeneratedNodeMasses(model, generatedNodes, ctx);
    buildGeneratedSupports(model, generatedNodes, allData, ctx);
    buildGeneratedConstraints(model, generatedNodes, allData, ctx);
  } else {
    const sourceLevel = asRecord(traceability.source_level, 'model.traceability.source_level');
    const layerZ = asNumber(sourceLevel.z, 'model.traceability.source_level.z');
    const layerName =
      readOptionalString(sourceLevel.level_id, 'model.traceability.source_level.level_id') ?? 'YAML Level';
    layers = [new Layer(layerZ, layerName)];

    buildSourceNodes(traceability, layerZ, allData, ctx);
    buildSourceMembers(traceability, allData, ctx);
    buildSourceFloors(traceability, layerZ, allData, ctx);
    collectUnsupportedWarnings(model, ctx.warnings);
  }

  ModelValidator.validateModel(allData, layers, { validateNumbers: false });

  return {
    commit(document: Document): ImportSummary {
      document.bulkLoad(allData, layers);
      const summary = buildSummary(units, document, ctx, mode, summaryFields);
      const metadata: ImportMetadata = {
        summary,
        sourceNodes: ctx.sourceNodeInfo,
        sourceElements: ctx.sourceElementInfo,
        materials: ctx.materials,
        sections: ctx.sections,
      };
      document.setImportMetadata(metadata);
      return summary;
    },
  };
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

/** source IDは対応/非対応要素を選別する前に全件を検査する。 */
function validateTraceabilityIds(traceability: UnknownRecord, mode: CalcYamlImportMode): void {
  const sourceNodes =
    mode === 'source'
      ? asArray(traceability.source_nodes, 'model.traceability.source_nodes')
      : readOptionalArray(traceability.source_nodes, 'model.traceability.source_nodes');
  const sourceMembers =
    mode === 'source'
      ? asArray(traceability.source_members, 'model.traceability.source_members')
      : readOptionalArray(traceability.source_members, 'model.traceability.source_members');
  const sourceSurfaces =
    mode === 'source'
      ? asArray(traceability.source_surfaces, 'model.traceability.source_surfaces')
      : readOptionalArray(traceability.source_surfaces, 'model.traceability.source_surfaces');

  assertUniqueIds(sourceNodes, 'model.traceability.source_nodes', 'source_node_id', (value, path) =>
    String(asIdNumber(value, path)),
  );
  assertUniqueIds(sourceMembers, 'model.traceability.source_members', 'source_member_id', asNonEmptyString);
  assertUniqueIds(sourceSurfaces, 'model.traceability.source_surfaces', 'source_surface_id', asNonEmptyString);
}

function assertUniqueIds(
  rows: unknown[],
  collectionPath: string,
  idKey: string,
  readId: (value: unknown, path: string) => string,
): void {
  const firstPathById = new Map<string, string>();
  rows.forEach((value, index) => {
    const rowPath = `${collectionPath}[${index}]`;
    const row = asRecord(value, rowPath);
    const path = `${rowPath}.${idKey}`;
    const id = readId(row[idKey], path);
    const firstPath = firstPathById.get(id);
    if (firstPath) {
      throw new Error(`Duplicate ${idKey} '${id}' at ${path}; first defined at ${firstPath}`);
    }
    firstPathById.set(id, path);
  });
}

function collectGeneratedReferencedNodeTags(model: UnknownRecord): Set<number> {
  const referenced = new Set<number>();
  const elements = asArray(model.elements, 'model.elements');
  for (let i = 0; i < elements.length; i++) {
    const raw = asRecord(elements[i], `model.elements[${i}]`);
    const type = asString(raw.type, `model.elements[${i}].type`);
    if (!isGeneratedLineElementType(type)) continue;
    referenced.add(asIdNumber(raw.node_i, `model.elements[${i}].node_i`));
    referenced.add(asIdNumber(raw.node_j, `model.elements[${i}].node_j`));
  }
  readOptionalArray(model.supports, 'model.supports').forEach((value, index) => {
    const row = asRecord(value, `model.supports[${index}]`);
    referenced.add(asIdNumber(row.node_tag, `model.supports[${index}].node_tag`));
  });
  readOptionalArray(model.nodal_masses, 'model.nodal_masses').forEach((value, index) => {
    const row = asRecord(value, `model.nodal_masses[${index}]`);
    referenced.add(asIdNumber(row.node_tag, `model.nodal_masses[${index}].node_tag`));
  });
  readOptionalArray(model.constraints, 'model.constraints').forEach((value, index) => {
    const path = `model.constraints[${index}]`;
    const row = asRecord(value, path);
    referenced.add(asIdNumber(row.slave_node_tag, `${path}.slave_node_tag`));
    readOptionalArray(row.terms, `${path}.terms`).forEach((termValue, termIndex) => {
      const term = asRecord(termValue, `${path}.terms[${termIndex}]`);
      referenced.add(asIdNumber(term.node_tag, `${path}.terms[${termIndex}].node_tag`));
    });
  });
  if (referenced.size === 0) {
    throw new Error('generated model does not reference any supported structural node');
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
  const firstPathByTag = new Map<number, string>();
  const usedCoords = new Map<string, string[]>();
  let skippedNodeCount = 0;
  for (let i = 0; i < rawNodes.length; i++) {
    const raw = asRecord(rawNodes[i], `model.nodes[${i}]`);
    const tagPath = `model.nodes[${i}].tag`;
    const tag = asIdNumber(raw.tag, tagPath);
    const firstPath = firstPathByTag.get(tag);
    if (firstPath) {
      throw new Error(`Duplicate generated node tag '${tag}' at ${tagPath}; first defined at ${firstPath}`);
    }
    firstPathByTag.set(tag, tagPath);
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
  const sourceLevel = readOptionalRecord(traceability.source_level, 'model.traceability.source_level');
  const sourceLevelZ =
    sourceLevel.z === undefined ? undefined : asNumber(sourceLevel.z, 'model.traceability.source_level.z');
  const sourceLevelName = readOptionalString(sourceLevel.level_id, 'model.traceability.source_level.level_id');
  return uniqueZ.map((z) => new Layer(z, sourceLevelName && sourceLevelZ === z ? sourceLevelName : `Generated Z=${z}`));
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
  for (let i = 0; i < elements.length; i++) {
    const path = `model.elements[${i}]`;
    const raw = asRecord(elements[i], path);
    const type = asString(raw.type, `${path}.type`);
    const tag = asIdNumber(raw.tag, `${path}.tag`);
    if (seenTags.has(tag)) throw new Error(`Duplicate generated element tag: ${tag}`);
    seenTags.add(tag);

    if (!isGeneratedLineElementType(type)) {
      ctx.warnings.push({
        code: 'UNSUPPORTED_GENERATED_ELEMENT',
        message: `Skipped unsupported generated element type '${type}' (${tag})`,
        path,
      });
      continue;
    }

    const nodeITag = asIdNumber(raw.node_i, `${path}.node_i`);
    const nodeJTag = asIdNumber(raw.node_j, `${path}.node_j`);
    const nodeI = nodesByTag.get(nodeITag);
    const nodeJ = nodesByTag.get(nodeJTag);
    if (!nodeI || !nodeJ) {
      throw new Error(`generated element ${tag} references missing node: ${!nodeI ? nodeITag : nodeJTag}`);
    }
    const origin = originsByTag.get(tag);
    const material = readOptionalString(raw.material_ref, `${path}.material_ref`) ?? origin?.material;
    let data: Beam | Truss | Spring;
    if (type === 'elasticTimoshenkoBeam3D') {
      requireNonZeroGeneratedLength(nodeI, nodeJ, tag, type);
      const beam = new Beam(nodeI, nodeJ);
      beam.section = readOptionalString(raw.section_ref, `${path}.section_ref`) ?? type;
      data = beam;
    } else if (type === 'truss3D') {
      requireNonZeroGeneratedLength(nodeI, nodeJ, tag, type);
      const truss = new Truss(nodeI, nodeJ);
      truss.section = readOptionalString(raw.section_ref, `${path}.section_ref`) ?? 'TRUSS';
      truss.material = material ?? '';
      truss.area = asNumber(raw.area, `${path}.area`);
      truss.areaUnit = unitOrDefault(ctx.units, 'area', 'mm^2');
      truss.elasticModulus =
        raw.elastic_modulus === undefined ? null : asNumber(raw.elastic_modulus, `${path}.elastic_modulus`);
      truss.stressUnit = unitOrDefault(ctx.units, 'stress', 'N/mm^2');
      data = truss;
    } else {
      if (nodeI === nodeJ) {
        throw new Error(`generated spring ${tag} must connect two distinct node tags`);
      }
      const spring = new Spring(nodeI, nodeJ);
      spring.section = readOptionalString(raw.section_ref, `${path}.section_ref`) ?? 'SPRING';
      const directions = readStructuralDofArray(raw.dir, `${path}.dir`);
      const stiffness = readNumberArray(raw.stiffness, `${path}.stiffness`);
      if (directions.length === 0 || directions.length !== stiffness.length) {
        throw new Error(`Invalid ${path}: dir and stiffness must have the same non-zero length`);
      }
      spring.components = directions.map((dof, index) => ({
        dof,
        stiffness: stiffness[index],
        unit: unitOrDefault(
          ctx.units,
          dof.startsWith('r') ? 'rotational_stiffness' : 'translational_stiffness',
          dof.startsWith('r') ? 'N*mm/rad' : 'N/mm',
        ),
      }));
      spring.orientX = raw.orient_x === undefined ? null : readCoord(raw.orient_x, `${path}.orient_x`);
      spring.orientY = raw.orient_y === undefined ? null : readCoord(raw.orient_y, `${path}.orient_y`);
      spring.shearDistance = raw.shear_dist === undefined ? null : readNumberPair(raw.shear_dist, `${path}.shear_dist`);
      spring.note = readOptionalString(raw.note, `${path}.note`) ?? '';
      data = spring;
    }
    allData.push(data);

    const notes = generatedElementNotes(type, origin);
    const info: ImportSourceElementInfo = {
      sourceId: String(tag),
      sourceType: type,
      sourceRef: origin?.sourceRef,
      elementTags: [tag],
      nodeSourceIds: [String(nodeITag), String(nodeJTag)],
      section: data.section,
      material,
      notes,
    };
    addSourceElementInfo(ctx, data, info);
    addSourceIdMapObject(ctx, {
      sourceId: String(tag),
      data,
      kind: 'member',
      type,
      detail: [
        `section=${data.section}`,
        material ? `material=${material}` : '',
        origin ? `source=${origin.sourceId}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
}

function requireNonZeroGeneratedLength(nodeI: Node, nodeJ: Node, tag: number, type: string): void {
  if (nodeI === nodeJ || nodeI.pos.sub(nodeJ.pos).length <= ModelValidator.MIN_MEMBER_LENGTH) {
    throw new Error(`generated ${type} element ${tag} resolves to zero length`);
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
    notes.push(
      `Generated from ${origin.sourceId} (${origin.sourceType}${origin.sourceSection ? ` section=${origin.sourceSection}` : ''}).`,
    );
  }
  return notes.length > 0 ? notes : undefined;
}

function applyGeneratedNodeMasses(
  model: UnknownRecord,
  nodesByTag: ReadonlyMap<number, Node>,
  ctx: BuildContext,
): void {
  const seen = new Set<number>();
  readOptionalArray(model.nodal_masses, 'model.nodal_masses').forEach((value, index) => {
    const path = `model.nodal_masses[${index}]`;
    const row = asRecord(value, path);
    const tag = asIdNumber(row.node_tag, `${path}.node_tag`);
    if (seen.has(tag)) throw new Error(`Duplicate nodal mass for node tag ${tag} at ${path}`);
    seen.add(tag);
    const node = getGeneratedNode(nodesByTag, tag, path);
    const values = readNumberArray(row.mass, `${path}.mass`);
    if (values.length !== 6) throw new Error(`Invalid ${path}.mass: expected 6 DOF values`);
    node.mass = {
      values: values as DofVector6,
      translationalUnit: unitOrDefault(ctx.units, 'translational_mass', 'N*s^2/mm'),
      rotationalUnit: unitOrDefault(ctx.units, 'rotational_inertia', 'N*mm*s^2'),
    };
  });
}

function buildGeneratedSupports(
  model: UnknownRecord,
  nodesByTag: ReadonlyMap<number, Node>,
  allData: DocumentData[],
  ctx: BuildContext,
): void {
  const seen = new Set<number>();
  readOptionalArray(model.supports, 'model.supports').forEach((value, index) => {
    const path = `model.supports[${index}]`;
    const row = asRecord(value, path);
    const tag = asIdNumber(row.node_tag, `${path}.node_tag`);
    if (seen.has(tag)) throw new Error(`Duplicate support for node tag ${tag} at ${path}`);
    seen.add(tag);
    const node = getGeneratedNode(nodesByTag, tag, path);
    const fixedDofs = [...new Set(readStructuralDofArray(row.dofs, `${path}.dofs`))];
    if (fixedDofs.length === 0) throw new Error(`Invalid ${path}.dofs: support must restrain at least one DOF`);
    const support = new Support(node, fixedDofs);
    allData.push(support);
    const sourceId = `support:${tag}`;
    addSourceElementInfo(ctx, support, {
      sourceId,
      sourceType: 'support',
      nodeSourceIds: [String(tag)],
      notes: [`Fixed DOFs: ${fixedDofs.join(', ')}`],
    });
    addSourceIdMapObject(ctx, {
      sourceId,
      data: support,
      kind: 'constraint',
      type: 'Support',
      detail: `node=${tag} dofs=${fixedDofs.join(',')}`,
    });
  });
}

function buildGeneratedConstraints(
  model: UnknownRecord,
  nodesByTag: ReadonlyMap<number, Node>,
  allData: DocumentData[],
  ctx: BuildContext,
): void {
  readOptionalArray(model.constraints, 'model.constraints').forEach((value, index) => {
    const path = `model.constraints[${index}]`;
    const row = asRecord(value, path);
    const kind = asString(row.kind, `${path}.kind`);
    if (kind !== 'equalDOF') throw new Error(`Unsupported ${path}.kind: ${kind}`);
    const slaveTag = asIdNumber(row.slave_node_tag, `${path}.slave_node_tag`);
    const slaveDof = readOneBasedDof(row.slave_dof, `${path}.slave_dof`);
    const terms = asArray(row.terms, `${path}.terms`).map((termValue, termIndex) => {
      const termPath = `${path}.terms[${termIndex}]`;
      const term = asRecord(termValue, termPath);
      const tag = asIdNumber(term.node_tag, `${termPath}.node_tag`);
      return {
        node: getGeneratedNode(nodesByTag, tag, termPath),
        dof: readOneBasedDof(term.dof, `${termPath}.dof`),
        coefficient: asNumber(term.coefficient, `${termPath}.coefficient`),
      };
    });
    if (terms.length === 0) throw new Error(`Invalid ${path}.terms: expected at least one master term`);
    const constraint = new Constraint(getGeneratedNode(nodesByTag, slaveTag, path), slaveDof, terms);
    allData.push(constraint);
    const sourceId = `constraint:${index}`;
    addSourceElementInfo(ctx, constraint, {
      sourceId,
      sourceType: kind,
      nodeSourceIds: [String(slaveTag), ...terms.map((term) => String(sourceTagOfNode(nodesByTag, term.node)))],
      notes: [`Slave DOF: ${slaveDof}`],
    });
    addSourceIdMapObject(ctx, {
      sourceId,
      data: constraint,
      kind: 'constraint',
      type: 'Constraint(equalDOF)',
      detail: `slave=${slaveTag}:${slaveDof} terms=${terms.length}`,
    });
  });
}

function getGeneratedNode(nodesByTag: ReadonlyMap<number, Node>, tag: number, path: string): Node {
  const node = nodesByTag.get(tag);
  if (!node) throw new Error(`${path} references missing generated node: ${tag}`);
  return node;
}

function sourceTagOfNode(nodesByTag: ReadonlyMap<number, Node>, target: Node): number {
  for (const [tag, node] of nodesByTag) if (node === target) return tag;
  throw new Error('Generated node source tag not found');
}

function buildGeneratedElementOrigins(traceability: UnknownRecord): Map<
  number,
  {
    sourceId: string;
    sourceType: string;
    sourceRef?: string;
    sourceSection?: string;
    material?: string;
  }
> {
  const origins = new Map<
    number,
    {
      sourceId: string;
      sourceType: string;
      sourceRef?: string;
      sourceSection?: string;
      material?: string;
    }
  >();
  addGeneratedOrigins(
    origins,
    readOptionalArray(traceability.source_members, 'model.traceability.source_members'),
    'source_member_id',
    'model.traceability.source_members',
  );
  addGeneratedOrigins(
    origins,
    readOptionalArray(traceability.source_surfaces, 'model.traceability.source_surfaces'),
    'source_surface_id',
    'model.traceability.source_surfaces',
  );
  return origins;
}

function addGeneratedOrigins(
  origins: Map<
    number,
    { sourceId: string; sourceType: string; sourceRef?: string; sourceSection?: string; material?: string }
  >,
  rows: unknown[],
  idKey: 'source_member_id' | 'source_surface_id',
  collectionPath: string,
): void {
  rows.forEach((value, index) => {
    const path = `${collectionPath}[${index}]`;
    const row = asRecord(value, path);
    const sourceId = asNonEmptyString(row[idKey], `${path}.${idKey}`);
    const sourceType = asNonEmptyString(row.source_type, `${path}.source_type`);
    const tags = readOptionalIdArray(row.generated_element_chain, `${path}.generated_element_chain`) ?? [];
    const sourceSection = readOptionalString(row.source_section, `${path}.source_section`);
    const sourceRef = readOptionalString(row.source_ref, `${path}.source_ref`);
    const material = inferMaterial(sourceType, sourceSection ?? '');
    tags.forEach((tag) => {
      const existing = origins.get(tag);
      if (existing) {
        throw new Error(
          `Duplicate generated element origin tag '${tag}' at ${path}.generated_element_chain; ` +
            `already assigned to source '${existing.sourceId}'`,
        );
      }
      origins.set(tag, {
        sourceId,
        sourceType,
        sourceRef,
        sourceSection,
        material,
      });
    });
  });
}

function buildSourceNodes(
  traceability: UnknownRecord,
  layerZ: number,
  allData: DocumentData[],
  ctx: BuildContext,
): void {
  const sourceNodes = asArray(traceability.source_nodes, 'model.traceability.source_nodes');
  for (let i = 0; i < sourceNodes.length; i++) {
    const raw = asRecord(sourceNodes[i], `model.traceability.source_nodes[${i}]`);
    const sourceId = String(asIdNumber(raw.source_node_id, `model.traceability.source_nodes[${i}].source_node_id`));
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
    const sourceId = asNonEmptyString(raw.source_member_id, `model.traceability.source_members[${i}].source_member_id`);
    const sourceType = asString(raw.source_type, `model.traceability.source_members[${i}].source_type`);
    if (sourceType !== 'beam' && sourceType !== 'hbrace') {
      ctx.warnings.push({
        code: 'UNSUPPORTED_SOURCE_MEMBER',
        message: `Skipped unsupported source member type '${sourceType}' (${sourceId})`,
        path: `model.traceability.source_members[${i}]`,
      });
      continue;
    }

    const nodeIds = readIdArray(raw.source_nodes, `model.traceability.source_members[${i}].source_nodes`);
    if (nodeIds.length !== 2) {
      throw new Error(`source member ${sourceId} must have exactly 2 source_nodes`);
    }
    const nodeI = getSourceNode(ctx, String(nodeIds[0]), `source member ${sourceId}`);
    const nodeJ = getSourceNode(ctx, String(nodeIds[1]), `source member ${sourceId}`);
    if (nodeI === nodeJ) {
      throw new Error(`source member ${sourceId} resolves to the same CAD node at both ends`);
    }
    const elementTags = readOptionalIdArray(
      raw.generated_element_chain,
      `model.traceability.source_members[${i}].generated_element_chain`,
    );
    const section =
      readOptionalString(raw.source_section, `model.traceability.source_members[${i}].source_section`) ??
      (sourceType === 'hbrace' ? 'TRUSS' : 'G1');
    const data: Beam | Truss =
      sourceType === 'hbrace'
        ? buildSourceHbrace(raw, nodeI, nodeJ, section, elementTags, ctx, `model.traceability.source_members[${i}]`)
        : new Beam(nodeI, nodeJ);
    data.section = section;
    allData.push(data);

    const material =
      data instanceof Truss
        ? data.material || undefined
        : (materialFromElements(ctx, elementTags) ?? inferMaterial(sourceType, section));
    const info: ImportSourceElementInfo = {
      sourceId,
      sourceType,
      sourceRef: readOptionalString(raw.source_ref, `model.traceability.source_members[${i}].source_ref`),
      elementTags,
      nodeSourceIds: nodeIds.map(String),
      section: data.section,
      material,
      notes:
        sourceType === 'hbrace'
          ? ['Imported as a dedicated axial Truss from the generated truss3D properties.']
          : undefined,
    };
    addSourceElementInfo(ctx, data, info);
    ctx.sourceIdMapObjects.push({
      sourceId,
      data,
      kind: 'member',
      type: sourceType === 'hbrace' ? 'Truss(hbrace)' : 'Beam',
      detail: `section=${data.section}${material ? ` material=${material}` : ''}`,
    });
  }
}

function buildSourceHbrace(
  raw: UnknownRecord,
  nodeI: Node,
  nodeJ: Node,
  section: string,
  elementTags: number[] | undefined,
  ctx: BuildContext,
  path: string,
): Truss {
  const generated = (elementTags ?? []).flatMap((tag) => {
    const element = ctx.elementsByTag.get(tag);
    if (!element) {
      ctx.warnings.push({
        code: 'HBRACE_GENERATED_ELEMENT_MISSING',
        message: `${path}.generated_element_chain references missing element tag ${tag}; available source/section properties were used.`,
        path: `${path}.generated_element_chain`,
      });
      return [];
    }
    const type = asString(element.type, `model.elements[tag=${tag}].type`);
    if (type !== 'truss3D') {
      throw new Error(`Invalid ${path}.generated_element_chain: hbrace element ${tag} must be truss3D, got '${type}'`);
    }
    return [{ tag, element }];
  });

  const sectionProperties = ctx.sections[section];
  const explicitArea = raw.area === undefined ? undefined : asNumber(raw.area, `${path}.area`);
  const sectionArea =
    sectionProperties?.area === undefined
      ? undefined
      : asNumber(sectionProperties.area, `model.sections.${section}.area`);
  const areas = [
    explicitArea,
    ...generated.map(({ tag, element }) => asNumber(element.area, `model.elements[tag=${tag}].area`)),
    sectionArea,
  ].filter((value): value is number => value !== undefined);
  if (areas.length === 0) {
    // Source-mode geometry remains usable without model.elements. Keep the
    // dedicated axial type and surface the missing property as an import
    // warning rather than flattening the brace back to Beam.
    areas.push(1);
    ctx.warnings.push({
      code: 'HBRACE_AREA_DEFAULTED',
      message: `${path} has no source/generated/section area; a 1 mm^2 placeholder was used.`,
      path,
    });
  }
  assertConsistentNumbers(areas, `${path}.area`);

  const generatedMaterials = generated
    .map(({ tag, element }) => readOptionalString(element.material_ref, `model.elements[tag=${tag}].material_ref`))
    .filter((value): value is string => value !== undefined);
  const material = uniqueString(generatedMaterials, `${path}.material`) ?? inferMaterial('hbrace', section) ?? '';
  const explicitElasticModulus =
    raw.elastic_modulus === undefined ? undefined : asNumber(raw.elastic_modulus, `${path}.elastic_modulus`);
  const generatedElasticModuli = generated
    .map(({ tag, element }) =>
      element.elastic_modulus === undefined
        ? undefined
        : asNumber(element.elastic_modulus, `model.elements[tag=${tag}].elastic_modulus`),
    )
    .filter((value): value is number => value !== undefined);
  const materialElasticModulus =
    material && ctx.materials[material]?.elastic_modulus !== undefined
      ? asNumber(ctx.materials[material].elastic_modulus, `model.materials.${material}.elastic_modulus`)
      : undefined;
  const elasticModuli = [explicitElasticModulus, ...generatedElasticModuli, materialElasticModulus].filter(
    (value): value is number => value !== undefined,
  );
  if (elasticModuli.length > 0) assertConsistentNumbers(elasticModuli, `${path}.elastic_modulus`);

  const truss = new Truss(nodeI, nodeJ);
  truss.material = material;
  truss.area = areas[0];
  truss.areaUnit = unitOrDefault(ctx.units, 'area', 'mm^2');
  truss.elasticModulus = elasticModuli[0] ?? null;
  truss.stressUnit = unitOrDefault(ctx.units, 'stress', 'N/mm^2');
  return truss;
}

function assertConsistentNumbers(values: ReadonlyArray<number>, path: string): void {
  const first = values[0];
  if (values.some((value) => Math.abs(value - first) > Math.max(1, Math.abs(first), Math.abs(value)) * 1e-12)) {
    throw new Error(`Invalid ${path}: inconsistent values (${values.join(', ')})`);
  }
}

function uniqueString(values: ReadonlyArray<string>, path: string): string | undefined {
  const unique = [...new Set(values)];
  if (unique.length > 1) throw new Error(`Invalid ${path}: inconsistent values (${unique.join(', ')})`);
  return unique[0];
}

function buildSourceFloors(
  traceability: UnknownRecord,
  layerZ: number,
  allData: DocumentData[],
  ctx: BuildContext,
): void {
  const sourceSurfaces = asArray(traceability.source_surfaces, 'model.traceability.source_surfaces');
  for (let i = 0; i < sourceSurfaces.length; i++) {
    const raw = asRecord(sourceSurfaces[i], `model.traceability.source_surfaces[${i}]`);
    const sourceId = asNonEmptyString(
      raw.source_surface_id,
      `model.traceability.source_surfaces[${i}].source_surface_id`,
    );
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
    if (
      Math.abs(x2 - x1) <= ModelValidator.MIN_MEMBER_LENGTH ||
      Math.abs(y2 - y1) <= ModelValidator.MIN_MEMBER_LENGTH
    ) {
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
    floor.section =
      readOptionalString(raw.source_section, `model.traceability.source_surfaces[${i}].source_section`) ??
      floor.section;
    floor.direction = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? FloorDirection.X : FloorDirection.Y;
    allData.push(floor);

    const elementTags = readOptionalIdArray(
      raw.generated_element_chain,
      `model.traceability.source_surfaces[${i}].generated_element_chain`,
    );
    const material = materialFromElements(ctx, elementTags) ?? inferMaterial(sourceType, floor.section);
    addSourceElementInfo(ctx, floor, {
      sourceId,
      sourceType,
      sourceRef: readOptionalString(raw.source_ref, `model.traceability.source_surfaces[${i}].source_ref`),
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
  row: {
    sourceId: string;
    data: DocumentData;
    kind: 'node' | 'member' | 'plane' | 'constraint';
    type: string;
    detail?: string;
  },
): void {
  if (ctx.sourceIdMapObjects.some((existing) => existing.sourceId === row.sourceId && existing.kind === row.kind))
    return;
  ctx.sourceIdMapObjects.push(row);
}

function collectUnsupportedWarnings(model: UnknownRecord, warnings: ImportWarning[]): void {
  const supports = readOptionalArray(model.supports, 'model.supports');
  const nodalMasses = readOptionalArray(model.nodal_masses, 'model.nodal_masses');
  const constraints = readOptionalArray(model.constraints, 'model.constraints');
  const elements = readOptionalArray(model.elements, 'model.elements');
  const twoNodeLinks = elements.filter((raw) => isRecord(raw) && raw.type === 'twoNodeLink3D');
  if (supports.length > 0) {
    warnings.push({
      code: 'SUPPORTS_NOT_IMPORTED',
      message: `${supports.length} supports were not imported.`,
      path: 'model.supports',
    });
  }
  if (nodalMasses.length > 0) {
    warnings.push({
      code: 'NODAL_MASSES_NOT_IMPORTED',
      message: `${nodalMasses.length} nodal masses were not imported.`,
      path: 'model.nodal_masses',
    });
  }
  if (constraints.length > 0) {
    warnings.push({
      code: 'CONSTRAINTS_NOT_IMPORTED',
      message: `${constraints.length} constraints were not imported.`,
      path: 'model.constraints',
    });
  }
  if (twoNodeLinks.length > 0) {
    warnings.push({
      code: 'SPRINGS_NOT_IMPORTED',
      message: `${twoNodeLinks.length} twoNodeLink3D spring elements were not imported.`,
      path: 'model.elements',
    });
  }
}

function buildSummary(
  units: Record<string, string>,
  doc: Document,
  ctx: BuildContext,
  mode: CalcYamlImportMode,
  fields: SummaryFields,
): ImportSummary {
  const counts = {
    nodes: doc.nodeList.length,
    beams: doc.allDataList.filter((data) => data.kind === 'beam').length,
    pillars: doc.allDataList.filter((data) => data.kind === 'pillar').length,
    trusses: doc.allDataList.filter((data) => data.kind === 'truss').length,
    springs: doc.allDataList.filter((data) => data.kind === 'spring').length,
    floors: doc.allDataList.filter((data) => data.kind === 'floor').length,
    walls: doc.allDataList.filter((data) => data.kind === 'wall').length,
    bearWalls: doc.allDataList.filter((data) => data.kind === 'bearWall').length,
    supports: doc.allDataList.filter((data) => data.kind === 'support').length,
    constraints: doc.allDataList.filter((data) => data.kind === 'constraint').length,
    layers: doc.layers.length,
  };
  return {
    ...counts,
    format: mode === 'generated' ? 'calc-yaml-generated' : 'calc-yaml',
    importMode: mode,
    modelName: fields.modelName,
    sourceJson: fields.sourceJson,
    analysisProfile: fields.analysisProfile,
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

function readSummaryFields(model: UnknownRecord): SummaryFields {
  return {
    modelName: readOptionalString(model.name, 'model.name') ?? '',
    sourceJson: readOptionalString(model.source_json, 'model.source_json'),
    analysisProfile: readOptionalString(model.analysis_profile, 'model.analysis_profile'),
  };
}

function indexElements(elements: unknown[]): Map<number, UnknownRecord> {
  const indexed = new Map<number, UnknownRecord>();
  const firstPathByTag = new Map<number, string>();
  elements.forEach((raw, i) => {
    const rowPath = `model.elements[${i}]`;
    const e = asRecord(raw, rowPath);
    const path = `${rowPath}.tag`;
    const tag = asIdNumber(e.tag, path);
    const firstPath = firstPathByTag.get(tag);
    if (firstPath) {
      throw new Error(`Duplicate element tag '${tag}' at ${path}; first defined at ${firstPath}`);
    }
    firstPathByTag.set(tag, path);
    indexed.set(tag, e);
  });
  return indexed;
}

function materialFromElements(ctx: BuildContext, tags: number[] | undefined): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  const refs = new Set<string>();
  for (const tag of tags) {
    const ref = readOptionalString(ctx.elementsByTag.get(tag)?.material_ref, `model.elements[tag=${tag}].material_ref`);
    if (ref) refs.add(ref);
  }
  return refs.size === 1 ? [...refs][0] : undefined;
}

function generatedSections(ctx: BuildContext, tags: number[] | undefined): string[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  const refs = new Set<string>();
  for (const tag of tags) {
    const ref = readOptionalString(ctx.elementsByTag.get(tag)?.section_ref, `model.elements[tag=${tag}].section_ref`);
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

function readNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected number array`);
  return value.map((item, index) => asNumber(item, `${label}[${index}]`));
}

function readNumberPair(value: unknown, label: string): [number, number] {
  const values = readNumberArray(value, label);
  if (values.length !== 2) throw new Error(`Invalid ${label}: expected exactly two numbers`);
  return [values[0], values[1]];
}

function readStructuralDofArray(value: unknown, label: string): StructuralDof[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected structural DOF array`);
  return value.map((item, index) => {
    const dof = asString(item, `${label}[${index}]`);
    if (!isStructuralDof(dof)) throw new Error(`Invalid ${label}[${index}]: unknown structural DOF '${dof}'`);
    return dof;
  });
}

function readOneBasedDof(value: unknown, label: string): StructuralDof {
  const index = asIdNumber(value, label);
  try {
    return structuralDofFromOneBasedIndex(index);
  } catch {
    throw new Error(`Invalid ${label}: expected a structural DOF number from 1 to 6`);
  }
}

function unitOrDefault(units: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return units[key] || fallback;
}

function readCoord(value: unknown, label: string): Point3D {
  if (!Array.isArray(value) || value.length !== 3) {
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
  const out = Object.create(null) as Record<string, string>;
  for (const [key, v] of Object.entries(r)) {
    out[key] = asString(v, `${label}.${key}`);
  }
  return out;
}

function toPropertyTable(value: unknown, label: string): ImportPropertyTable {
  const r = readOptionalRecord(value, label);
  // YAML由来のmaterial/section名をprototype setterへ渡さない。
  const out = Object.create(null) as ImportPropertyTable;
  for (const [key, raw] of Object.entries(r)) {
    const prop = asRecord(raw, `${label}.${key}`);
    out[key] = { ...prop };
  }
  return out;
}

function readIdArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected ID array`);
  return value.map((x, i) => asIdNumber(x, `${label}[${i}]`));
}

function readOptionalIdArray(value: unknown, label: string): number[] | undefined {
  if (value === undefined) return undefined;
  const ids = readIdArray(value, label);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Invalid ${label}: duplicate element tag`);
  }
  return ids;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array`);
  return value;
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

function readOptionalRecord(value: unknown, label: string): UnknownRecord {
  if (value === undefined) return {};
  return asRecord(value, label);
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected finite number`);
  }
  return value;
}

function asIdNumber(value: unknown, label: string): number {
  const number = asNumber(value, label);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Invalid ${label}: expected a non-negative integer ID`);
  }
  return number;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}: expected string`);
  return value;
}

function asNonEmptyString(value: unknown, label: string): string {
  const string = asString(value, label);
  if (string.length === 0) throw new Error(`Invalid ${label}: expected non-empty string`);
  return string;
}

function asVersionString(value: unknown, label: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new Error(`Invalid ${label}: expected string or number`);
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, label);
}
