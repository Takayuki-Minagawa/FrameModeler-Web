import type { DocumentData } from './DocumentData';

export interface ImportWarning {
  code: string;
  message: string;
  path?: string;
}

export interface ImportSourceNodeInfo {
  sourceId: string;
  tag?: number;
  coord?: [number, number, number];
}

export interface ImportSourceElementInfo {
  sourceId: string;
  sourceType: string;
  sourceRef?: string;
  elementTags?: number[];
  nodeSourceIds?: string[];
  section?: string;
  material?: string;
  notes?: string[];
}

export type ImportPropertyTable = Record<string, Record<string, unknown>>;

export interface ImportCountSummary {
  nodes: number;
  beams: number;
  pillars: number;
  floors: number;
  walls: number;
  bearWalls: number;
  layers: number;
}

export interface ImportIdMapRow {
  sourceId: string;
  appNumber: number;
  kind: 'node' | 'member' | 'plane';
  type: string;
  detail?: string;
}

export interface ImportSummary extends ImportCountSummary {
  format: string;
  importMode?: string;
  modelName: string;
  sourceJson?: string;
  analysisProfile?: string;
  units: Record<string, string>;
  warnings: ImportWarning[];
  sourceIdMap: ImportIdMapRow[];
  materials: ImportPropertyTable;
  sections: ImportPropertyTable;
}

export interface ImportMetadata {
  summary: ImportSummary;
  sourceNodes: Map<DocumentData, ImportSourceNodeInfo[]>;
  sourceElements: Map<DocumentData, ImportSourceElementInfo[]>;
  materials: ImportPropertyTable;
  sections: ImportPropertyTable;
}
