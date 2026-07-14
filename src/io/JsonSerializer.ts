import { Node } from '../data/Node';
import { Beam } from '../data/Beam';
import { Pillar } from '../data/Pillar';
import { Floor } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Member } from '../data/Member';
import { Plane } from '../data/Plane';
import { Document } from '../data/Document';
import { ModelValidator } from '../data/ModelValidator';
import { JSON_SCHEMA_VERSION, type JsonDocument, type JsonMember } from './JsonSchema';
import { encodeImportMetadata } from './ImportMetadataCodec';

/** DocumentをJSON文字列にシリアライズ */
export function serializeJson(): string {
  return JSON.stringify(exportDocumentJson(), null, 2);
}

/** History/draftも利用できる、plain v1 JSON objectへの共通export API。 */
export function exportDocumentJson(doc: Document = Document.instance): JsonDocument {
  ModelValidator.validateModel(doc.allDataList, doc.layers);

  const json: JsonDocument = {
    schemaVersion: JSON_SCHEMA_VERSION,
    nodes: [],
    beams: [],
    pillars: [],
    floors: [],
    walls: [],
    bearWalls: [],
    layers: [],
  };

  // 厳密なコンストラクタ同定で振り分ける（instanceof の継承順依存を排除, I-6）
  for (const data of doc.allDataList) {
    if (data.constructor === Node) {
      const node = data as Node;
      json.nodes.push({
        number: node.number,
        pos: { x: node.pos.x, y: node.pos.y, z: node.pos.z },
      });
    } else if (data.constructor === Beam) {
      json.beams.push(memberToJson(data as Beam));
    } else if (data.constructor === Pillar) {
      json.pillars.push(memberToJson(data as Pillar));
    } else if (data.constructor === Floor) {
      const floor = data as Floor;
      json.floors.push({
        number: floor.number,
        nodes: getPlaneNodeNumbers(floor),
        weight: floor.weight,
        direction: floor.direction,
        section: floor.section || undefined,
      });
    } else if (data.constructor === BearWall) {
      const bw = data as BearWall;
      json.bearWalls.push({
        number: bw.number,
        nodes: getPlaneNodeNumbers(bw),
        section: bw.section || undefined,
      });
    } else if (data.constructor === Wall) {
      const wall = data as Wall;
      json.walls.push({
        number: wall.number,
        nodes: getPlaneNodeNumbers(wall),
        weight: wall.weight,
        section: wall.section || undefined,
      });
    }
  }

  for (const layer of doc.layers) {
    json.layers.push({
      name: layer.name,
      posZ: layer.posZ,
    });
  }

  if (doc.importMetadata) {
    json.importMetadata = encodeImportMetadata(doc.importMetadata, doc.allDataList, doc.layers.length);
  }

  return json;
}

function memberToJson(member: Member): JsonMember {
  const rawI = member.nodeI!;
  const rawJ = member.nodeJ!;
  const [nodeI, nodeJ] = rawI.compareTo(rawJ) < 0 ? [rawI, rawJ] : [rawJ, rawI];
  return {
    number: member.number,
    nodeI: nodeI.number,
    nodeJ: nodeJ.number,
    section: member.section || undefined,
  };
}

function getPlaneNodeNumbers(plane: Plane): number[] {
  return plane.nodeList.map((n) => n.number);
}

/** JSON文字列をファイルとしてダウンロード */
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
