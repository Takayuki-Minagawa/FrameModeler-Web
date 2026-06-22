import { Node } from '../data/Node';
import { Beam } from '../data/Beam';
import { Pillar } from '../data/Pillar';
import { Floor } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Member } from '../data/Member';
import { Plane } from '../data/Plane';
import { Document } from '../data/Document';
import type { JsonDocument, JsonMember } from './JsonDeserializer';

/** DocumentをJSON文字列にシリアライズ */
export function serializeJson(): string {
  const doc = Document.instance;

  const json: JsonDocument = {
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
        select: node.select,
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
        select: floor.select,
        weight: floor.weight,
        direction: floor.direction,
        section: floor.section || undefined,
      });
    } else if (data.constructor === BearWall) {
      const bw = data as BearWall;
      json.bearWalls.push({
        number: bw.number,
        nodes: getPlaneNodeNumbers(bw),
        select: bw.select,
        section: bw.section || undefined,
      });
    } else if (data.constructor === Wall) {
      const wall = data as Wall;
      json.walls.push({
        number: wall.number,
        nodes: getPlaneNodeNumbers(wall),
        select: wall.select,
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

  return JSON.stringify(json, null, 2);
}

function memberToJson(member: Member): JsonMember {
  return {
    number: member.number,
    nodeI: member.nodeI!.number,
    nodeJ: member.nodeJ!.number,
    select: member.select,
    section: member.section || undefined,
  };
}

function getPlaneNodeNumbers(plane: Plane): number[] {
  return plane.nodeList.map(n => n.number);
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
