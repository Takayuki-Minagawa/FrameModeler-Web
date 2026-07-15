import { Document } from '../data/Document';
import { Layer } from '../data/Layer';
import { ModelValidator } from '../data/ModelValidator';
import { ImportCommand } from '../commands/DocumentCommands';
import { deserializeDocumentData } from './DocumentDataCodecRegistry';
import type { DocumentImportPlan } from './DocumentImportPlan';
import { decodeImportMetadata } from './ImportMetadataCodec';
import { setLayerJsonExtras } from './LayerJsonExtras';
import { parseJsonDocument } from './JsonSchema';

export type { JsonDocument, JsonMember } from './JsonSchema';

/** JSON文字列をparse → schema検証 → migration → codec buildしてatomicに読み込む。 */
export function deserializeJson(jsonString: string): void {
  importDocumentJson(jsonString);
}

/** History/draftも利用できる共通import API。 */
export function importDocumentJson(jsonString: string): void {
  const plan = createJsonImportPlan(jsonString);
  Document.instance.execute(new ImportCommand('JSON読込', (document) => plan.commit(document)));
}

/** parse/schema migration/domain buildを行い、Documentを変更しない同期import planを返す。 */
export function createJsonImportPlan(jsonString: string): DocumentImportPlan {
  const json = parseJsonDocument(jsonString);
  const allData = deserializeDocumentData(json);
  const layers = json.layers.map((raw) => {
    const layer = new Layer(raw.posZ, raw.name, {
      id: raw.id,
      visible: raw.visible,
      locked: raw.locked,
    });
    setLayerJsonExtras(layer, raw);
    return layer;
  });

  ModelValidator.validateModel(allData, layers, { validateNumbers: false });

  // metadata参照・summary整合性もDocument置換前に解決する。
  const decodedMetadata = json.importMetadata
    ? decodeImportMetadata(json.importMetadata, allData, layers.length)
    : undefined;
  return {
    commit(document: Document): void {
      document.bulkLoad(allData, layers);
      if (decodedMetadata) {
        decodedMetadata.synchronizeAppNumbers();
        document.setImportMetadata(decodedMetadata.metadata);
      }
    },
  };
}
