import { Document } from '../data/Document';
import { importDocumentJson } from './JsonDeserializer';
import { parseJsonDocument } from './JsonSchema';
import { exportDocumentJson } from './JsonSerializer';

/** model JSONとは分離して保持するHistory/draft向け一時表示状態。 */
export interface PortableDocumentSnapshot {
  json: string;
  filename: string;
  shownLayer?: null | { posZ: number; name: string };
}

export function exportDocumentSnapshot(document: Document = Document.instance): PortableDocumentSnapshot {
  const shownLayer = document.shownLayer;
  return {
    json: JSON.stringify(exportDocumentJson(document), null, 2),
    filename: document.filename,
    shownLayer: shownLayer ? { posZ: shownLayer.posZ, name: shownLayer.name } : null,
  };
}

/** legacyのjson+filename snapshotも読み込める。shownLayer不整合はcommit前に拒否する。 */
export function importDocumentSnapshot(
  snapshot: PortableDocumentSnapshot,
  document: Document = Document.instance,
): void {
  if (typeof snapshot.filename !== 'string') {
    throw new Error('Invalid document snapshot filename: expected string');
  }
  const parsed = parseJsonDocument(snapshot.json);
  let shownLayerIndex: number | null | undefined;
  if (snapshot.shownLayer === null) {
    shownLayerIndex = null;
  } else if (snapshot.shownLayer !== undefined) {
    const { posZ, name } = snapshot.shownLayer;
    if (typeof posZ !== 'number' || !Number.isFinite(posZ) || typeof name !== 'string') {
      throw new Error('Invalid document snapshot shownLayer');
    }
    const index = parsed.layers.findIndex((layer) => layer.posZ === posZ && layer.name === name);
    if (index < 0) {
      throw new Error(`Invalid document snapshot shownLayer: layer not found (${name}, ${posZ})`);
    }
    shownLayerIndex = index;
  }

  importDocumentJson(snapshot.json);
  document.filename = snapshot.filename;
  if (shownLayerIndex === null) document.shownLayer = null;
  else if (shownLayerIndex !== undefined) document.shownLayer = document.layers[shownLayerIndex] ?? null;
}
