import { stateValuesEqual } from './DataState';
import type { Document } from './Document';
import type { DocumentData } from './DocumentData';
import { Node } from './Node';
import { cloneNodeMass } from './StructuralDof';

export interface NodeMergePlan {
  /** 削除されるNode → 残すNode。 */
  replacements: Map<Node, Node>;
  /** 結合の結果、既存要素と完全に同じ内容になり削除される要素。 */
  redundantElements: DocumentData[];
}

/**
 * 許容距離以内にあるNodeを結合する計画を作る。Documentは変更しない。
 *
 * 次のNodeは結合しない。
 * - 同じ要素が両方を参照している（結合すると零長部材・退化面・自己拘束になる）
 * - 双方に質量が設定されている
 * - ロック中のレイヤーに属する、またはロック中の要素から参照されている
 *
 * 残すNodeは Document の並び順（Z, Y, X 昇順）で先に現れる方とする。
 */
export function planNodeMerge(document: Document, tolerance: number): NodeMergePlan {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError('Merge tolerance must be a non-negative finite number');
  }

  const referencing = new Map<Node, Set<DocumentData>>();
  for (const data of document.allDataList) {
    for (const node of data.referencedNodes) {
      const set = referencing.get(node);
      if (set) set.add(data);
      else referencing.set(node, new Set([data]));
    }
  }

  const cellSize = Math.max(tolerance, 1e-9);
  const cells = new Map<string, Node[]>();
  // 代表Nodeごとに、結合済みNode群を参照する要素と質量の有無を持つ。
  const groupElements = new Map<Node, Set<DocumentData>>();
  const groupHasMass = new Map<Node, boolean>();
  const replacements = new Map<Node, Node>();

  for (const node of document.nodeList) {
    const elements = referencing.get(node) ?? new Set<DocumentData>();
    if (document.isDataLocked(node) || [...elements].some((element) => document.isDataLocked(element))) continue;

    const cx = Math.floor(node.pos.x / cellSize);
    const cy = Math.floor(node.pos.y / cellSize);
    const cz = Math.floor(node.pos.z / cellSize);
    let target: Node | null = null;
    let targetDistance = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const candidate of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const distance = candidate.pos.sub(node.pos).length;
            if (distance > tolerance || distance >= targetDistance) continue;
            if (node.mass && groupHasMass.get(candidate)) continue;
            const shared = groupElements.get(candidate)!;
            if ([...elements].some((element) => shared.has(element))) continue;
            target = candidate;
            targetDistance = distance;
          }
        }
      }
    }

    if (target) {
      replacements.set(node, target);
      const shared = groupElements.get(target)!;
      for (const element of elements) shared.add(element);
      if (node.mass) groupHasMass.set(target, true);
      continue;
    }

    const key = `${cx},${cy},${cz}`;
    const cell = cells.get(key);
    if (cell) cell.push(node);
    else cells.set(key, [node]);
    groupElements.set(node, new Set(elements));
    groupHasMass.set(node, node.mass !== null);
  }

  return { replacements, redundantElements: findRedundantElements(document, replacements) };
}

/** 参照を付け替えた後に、他の要素と種別・参照Node・属性がすべて一致する要素を列挙する。 */
function findRedundantElements(document: Document, replacements: ReadonlyMap<Node, Node>): DocumentData[] {
  if (replacements.size === 0) return [];
  const resolve = (node: Node): Node => replacements.get(node) ?? node;
  const groups = new Map<string, DocumentData[]>();
  const ids = new Map<Node, number>();
  const idOf = (node: Node): number => {
    let id = ids.get(node);
    if (id === undefined) {
      id = ids.size;
      ids.set(node, id);
    }
    return id;
  };
  let touched = false;
  for (const data of document.allDataList) {
    if (data instanceof Node) continue;
    if (data.referencedNodes.some((node) => replacements.has(node))) touched = true;
    const key = `${data.kind}:${data.referencedNodes.map((node) => idOf(resolve(node))).join(',')}`;
    const group = groups.get(key);
    if (group) group.push(data);
    else groups.set(key, [data]);
  }
  if (!touched) return [];

  const redundant: DocumentData[] = [];
  for (const group of groups.values()) {
    if (group.length < 2 || !group.some((data) => data.referencedNodes.some((node) => replacements.has(node)))) {
      continue;
    }
    const kept: Array<Record<string, unknown>> = [];
    for (const data of group) {
      const state = resolvedState(data, resolve);
      if (kept.some((other) => stateValuesEqual(other, state))) redundant.push(data);
      else kept.push(state);
    }
  }
  return redundant;
}

/** 参照Nodeを付け替え後の値へ置き換えた比較用state。元の要素は変更しない。 */
function resolvedState(data: DocumentData, resolve: (node: Node) => Node): Record<string, unknown> {
  const mapValue = (value: unknown): unknown => {
    if (value instanceof Node) return resolve(value);
    if (Array.isArray(value)) return value.map(mapValue);
    if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapValue(item)]));
    }
    return value;
  };
  return mapValue({ ...data.captureState() }) as Record<string, unknown>;
}

/**
 * 結合計画をDocumentへ適用する。Document.execute / transaction の中から呼ぶこと。
 * 質量は、残すNodeに無く削除するNodeにある場合だけ引き継ぐ。
 */
export function applyNodeMerge(document: Document, plan: NodeMergePlan): void {
  if (plan.replacements.size === 0) return;
  for (const [removed, kept] of plan.replacements) {
    if (!kept.mass && removed.mass) kept.mass = cloneNodeMass(removed.mass);
  }
  for (const data of document.allDataList) {
    if (data.referencedNodes.some((node) => plan.replacements.has(node))) data.remapNodes(plan.replacements);
  }
  document.removeMany([...plan.redundantElements, ...plan.replacements.keys()]);
}

/** どの要素からも参照されていない、ロックされていないNodeを返す。 */
export function findOrphanNodes(document: Document): Node[] {
  const referenced = new Set<Node>();
  for (const data of document.allDataList) {
    for (const node of data.referencedNodes) referenced.add(node);
  }
  return document.nodeList.filter((node) => !referenced.has(node) && !document.isDataLocked(node));
}
