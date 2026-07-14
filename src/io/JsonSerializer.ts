import { Document } from '../data/Document';
import { ModelValidator } from '../data/ModelValidator';
import { serializeDocumentData } from './DocumentDataCodecRegistry';
import { encodeImportMetadata } from './ImportMetadataCodec';
import { getLayerJsonExtras } from './LayerJsonExtras';
import { JSON_SCHEMA_VERSION, type JsonDocument } from './JsonSchema';

/** DocumentをJSON文字列にシリアライズ。 */
export function serializeJson(): string {
  return JSON.stringify(exportDocumentJson(), null, 2);
}

/** History/draftも利用できるplain v2 JSON objectへの共通export API。 */
export function exportDocumentJson(doc: Document = Document.instance): JsonDocument {
  ModelValidator.validateModel(doc.allDataList, doc.layers);
  const json: JsonDocument = {
    schemaVersion: JSON_SCHEMA_VERSION,
    ...serializeDocumentData(doc.allDataList),
    layers: doc.layers.map((layer) => ({
      ...getLayerJsonExtras(layer),
      id: layer.id,
      name: layer.name,
      posZ: layer.posZ,
      visible: layer.visible,
      locked: layer.locked,
    })),
  };

  if (doc.importMetadata) {
    json.importMetadata = encodeImportMetadata(doc.importMetadata, doc.allDataList, doc.layers.length);
  }
  return json;
}

/** JSON文字列をファイルとしてダウンロード。 */
export function downloadJson(filename: string): void {
  const jsonStr = serializeJson();
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
