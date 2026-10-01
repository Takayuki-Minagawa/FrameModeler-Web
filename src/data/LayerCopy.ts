import { Document } from './Document';
import { planElementCopies } from './ElementCopy';
import type { Layer } from './Layer';
import { Node } from './Node';
import { Point3D } from '../math/Point3D';

const Z_TOLERANCE = 1e-6;

/**
 * source階の平面内データをtarget階へ全登録型共通の複製規則でコピーする。
 * 柱・壁など階間にまたがる要素は意図せぬ二重化を避けるため対象外とする。
 */
export function copyLayerContents(source: Layer, target: Layer, document: Document = Document.instance): void {
  if (source === target) return;
  if (target.locked) throw new Error(`Cannot copy elements to locked layer '${target.name}'`);
  const sourceNodes = document.nodeList.filter((node) => Math.abs(node.pos.z - source.posZ) <= Z_TOLERANCE);
  const onSourceLayer = new Set(sourceNodes);
  const elements = document.allDataList.filter(
    (data) => !(data instanceof Node) && data.referencedNodes.every((node) => onSourceLayer.has(node)),
  );

  const additions = planElementCopies(document, {
    nodes: sourceNodes,
    elements,
    // 複製先は丸め誤差なくtarget階の高さへ載せる。
    transforms: [(position) => new Point3D(position.x, position.y, target.posZ)],
  });
  if (additions.length > 0) document.addMany(additions);
}
