import type { DocumentData } from './DocumentData';
import { Node } from './Node';
import { registeredTypeOf } from './typeRegistry';

/**
 * 登録済みの全モデル型を、型ごとの state API だけで複製する。
 * 選択状態と number は複製しない。
 *
 * - Node: nodeMap に対応があればそのNodeを返し、無ければ複製して nodeMap へ登録する。
 * - Node以外: 参照Nodeをすべて nodeMap で付け替える。対応の無い参照があれば例外にする。
 */
export function cloneWithNodes<T extends DocumentData>(data: T, nodeMap: Map<Node, Node>): T {
  if (data instanceof Node) {
    const mapped = nodeMap.get(data);
    if (mapped) return mapped as DocumentData as T;
  }
  const entry = registeredTypeOf(data);
  if (!entry) throw new Error(`Cannot clone unsupported DocumentData kind '${data.kind}'`);
  for (const node of data.referencedNodes) {
    if (!nodeMap.has(node)) {
      throw new Error(`Cannot clone ${data.kind}: nodeMap has no entry for Node ${node.number}`);
    }
  }

  const copy = new (entry.ctor as unknown as new () => T)();
  copy.restoreState(data.captureState());
  copy.remapNodes(nodeMap);
  if (data instanceof Node) nodeMap.set(data, copy as DocumentData as Node);
  return copy;
}
