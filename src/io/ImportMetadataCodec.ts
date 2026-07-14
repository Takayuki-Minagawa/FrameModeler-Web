import { BearWall } from '../data/BearWall';
import { Beam } from '../data/Beam';
import type { DocumentData } from '../data/DocumentData';
import { Floor } from '../data/Floor';
import type { ImportMetadata } from '../data/ImportMetadata';
import { Node } from '../data/Node';
import { Pillar } from '../data/Pillar';
import { Wall } from '../data/Wall';
import { categoryOf } from '../data/typeRegistry';
import { validateJsonImportMetadata, type JsonDataReference, type JsonImportMetadata } from './JsonSchema';

export interface DecodedImportMetadata {
  metadata: ImportMetadata;
  /** Document.bulkLoadによる再採番後にsummaryのappNumberを同期する。 */
  synchronizeAppNumbers(): void;
}

/** ImportMetadataのMapキーをstableなcategory/number参照へ変換する。 */
export function encodeImportMetadata(
  metadata: ImportMetadata,
  dataList: ReadonlyArray<DocumentData>,
  layerCount: number,
): JsonImportMetadata {
  const dataSet = new Set(dataList);
  const sourceNodes = [...metadata.sourceNodes.entries()].map(([data, values], index) => {
    assertDocumentMember(data, dataSet, `importMetadata.sourceNodes[${index}]`);
    return { data: dataReferenceOf(data), values };
  });
  const sourceElements = [...metadata.sourceElements.entries()].map(([data, values], index) => {
    assertDocumentMember(data, dataSet, `importMetadata.sourceElements[${index}]`);
    return { data: dataReferenceOf(data), values };
  });
  const encoded = validateJsonImportMetadata({
    summary: metadata.summary,
    sourceNodes,
    sourceElements,
    materials: metadata.materials,
    sections: metadata.sections,
  });
  // in-memory metadataのstale summary参照/件数も保存前に拒否する。
  decodeImportMetadata(encoded, dataList, layerCount);
  return encoded;
}

/** plain metadataを候補DocumentDataへ解決する。Documentは変更しない。 */
export function decodeImportMetadata(
  json: JsonImportMetadata,
  dataList: ReadonlyArray<DocumentData>,
  layerCount: number,
): DecodedImportMetadata {
  const byReference = indexDataReferences(dataList);
  const sourceNodes = new Map<DocumentData, JsonImportMetadata['sourceNodes'][number]['values']>();
  json.sourceNodes.forEach((mapping, index) => {
    const data = resolveDataReference(mapping.data, byReference, `importMetadata.sourceNodes[${index}].data`);
    if (!(data instanceof Node)) {
      throw new Error(`Invalid importMetadata.sourceNodes[${index}].data: expected Node`);
    }
    sourceNodes.set(
      data,
      mapping.values.map((value) => ({
        ...value,
        coord: value.coord ? ([...value.coord] as [number, number, number]) : undefined,
      })),
    );
  });

  const sourceElements = new Map<DocumentData, JsonImportMetadata['sourceElements'][number]['values']>();
  json.sourceElements.forEach((mapping, index) => {
    const data = resolveDataReference(mapping.data, byReference, `importMetadata.sourceElements[${index}].data`);
    if (data instanceof Node) {
      throw new Error(`Invalid importMetadata.sourceElements[${index}].data: expected Member or Plane`);
    }
    sourceElements.set(
      data,
      mapping.values.map((value) => ({
        ...value,
        elementTags: value.elementTags ? [...value.elementTags] : undefined,
        nodeSourceIds: value.nodeSourceIds ? [...value.nodeSourceIds] : undefined,
        notes: value.notes ? [...value.notes] : undefined,
      })),
    );
  });

  validateSummaryCounts(json, dataList, layerCount);
  const summaryBindings = json.summary.sourceIdMap.map((row, index) => {
    const ref: JsonDataReference = { category: row.kind, number: row.appNumber };
    return resolveDataReference(ref, byReference, `importMetadata.summary.sourceIdMap[${index}]`);
  });
  const metadata: ImportMetadata = {
    summary: {
      ...json.summary,
      units: { ...json.summary.units },
      warnings: json.summary.warnings.map((warning) => ({ ...warning })),
      sourceIdMap: json.summary.sourceIdMap.map((row) => ({ ...row })),
      materials: json.summary.materials,
      sections: json.summary.sections,
    },
    sourceNodes,
    sourceElements,
    materials: json.materials,
    sections: json.sections,
  };

  return {
    metadata,
    synchronizeAppNumbers: () => {
      metadata.summary.sourceIdMap.forEach((row, index) => {
        row.appNumber = summaryBindings[index].number;
      });
    },
  };
}

export function dataReferenceOf(data: DocumentData): JsonDataReference {
  const category = categoryOf(data);
  if (!category) throw new Error(`Cannot serialize metadata reference for unsupported type '${data.constructor.name}'`);
  if (!Number.isInteger(data.number) || data.number < 0) {
    throw new Error(`Cannot serialize metadata reference with invalid number '${data.number}'`);
  }
  return { category, number: data.number };
}

function indexDataReferences(dataList: ReadonlyArray<DocumentData>): Map<string, DocumentData> {
  const indexed = new Map<string, DocumentData>();
  dataList.forEach((data, index) => {
    const ref = dataReferenceOf(data);
    const key = referenceKey(ref);
    if (indexed.has(key)) throw new Error(`Duplicate model reference ${key} at data[${index}]`);
    indexed.set(key, data);
  });
  return indexed;
}

function resolveDataReference(
  ref: JsonDataReference,
  indexed: ReadonlyMap<string, DocumentData>,
  path: string,
): DocumentData {
  const data = indexed.get(referenceKey(ref));
  if (!data) throw new Error(`Invalid ${path}: model reference not found (${referenceKey(ref)})`);
  return data;
}

function referenceKey(ref: JsonDataReference): string {
  return `${ref.category}:${ref.number}`;
}

function assertDocumentMember(data: DocumentData, dataSet: ReadonlySet<DocumentData>, path: string): void {
  if (!dataSet.has(data)) throw new Error(`Invalid ${path}: referenced data does not belong to this Document`);
}

function validateSummaryCounts(
  json: JsonImportMetadata,
  dataList: ReadonlyArray<DocumentData>,
  layerCount: number,
): void {
  const actual = {
    nodes: countExact(dataList, Node),
    beams: countExact(dataList, Beam),
    pillars: countExact(dataList, Pillar),
    floors: countExact(dataList, Floor),
    walls: countExact(dataList, Wall),
    bearWalls: countExact(dataList, BearWall),
    layers: layerCount,
  };
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (json.summary[key] !== actual[key]) {
      throw new Error(
        `Invalid importMetadata.summary.${key}: expected ${actual[key]} for the model, got ${json.summary[key]}`,
      );
    }
  }
}

function countExact(dataList: ReadonlyArray<DocumentData>, ctor: Function): number {
  return dataList.filter((data) => data.constructor === ctor).length;
}
