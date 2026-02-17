import { Node } from '../data/Node';
import { Beam } from '../data/Beam';
import { Pillar } from '../data/Pillar';
import { Floor } from '../data/Floor';
import { Wall } from '../data/Wall';
import { BearWall } from '../data/BearWall';
import { Plane } from '../data/Plane';
import { Document } from '../data/Document';
import type { JsonDocument } from './JsonDeserializer';

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

  for (const data of doc.allDataList) {
    if (data instanceof Node) {
      json.nodes.push({
        number: data.number,
        pos: { x: data.pos.x, y: data.pos.y, z: data.pos.z },
        select: data.select,
      });
    } else if (data instanceof Beam) {
      json.beams.push({
        number: data.number,
        nodeI: data.nodeI!.number,
        nodeJ: data.nodeJ!.number,
        select: data.select,
        section: data.section || undefined,
      });
    } else if (data instanceof Pillar) {
      json.pillars.push({
        number: data.number,
        nodeI: data.nodeI!.number,
        nodeJ: data.nodeJ!.number,
        select: data.select,
        section: data.section || undefined,
      });
    } else if (data instanceof Floor) {
      json.floors.push({
        number: data.number,
        nodes: getPlaneNodeNumbers(data),
        select: data.select,
        weight: data.weight,
        direction: data.direction,
        section: data.section || undefined,
      });
    } else if (data instanceof BearWall) {
      // BearWall must be checked before Wall (BearWall extends Plane, not Wall)
      json.bearWalls.push({
        number: data.number,
        nodes: getPlaneNodeNumbers(data),
        select: data.select,
        section: data.section || undefined,
      });
    } else if (data instanceof Wall) {
      json.walls.push({
        number: data.number,
        nodes: getPlaneNodeNumbers(data),
        select: data.select,
        weight: data.weight,
        section: data.section || undefined,
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
