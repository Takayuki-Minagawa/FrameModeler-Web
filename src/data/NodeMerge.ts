import { cloneWithNodes } from './DataClone';
import { stateValuesEqual } from './DataState';
import type { Document } from './Document';
import type { DocumentData, DocumentDataKind } from './DocumentData';
import { ModelValidator } from './ModelValidator';
import { Node } from './Node';
import { Plane } from './Plane';
import { cloneNodeMass } from './StructuralDof';

export interface NodeMergePlan {
  /** 削除されるNode → 残すNode。 */
  replacements: Map<Node, Node>;
  /** 結合の結果、既存要素と完全に同じ内容になり削除される要素。 */
  redundantElements: DocumentData[];
}

/** Nodeがレイヤーの高さにあるとみなす許容差 (mm)。 */
const LAYER_ELEVATION_TOLERANCE = 1e-6;

/**
 * 結合で同一になったとき、1つだけ残してよい種別。
 * ばね・トラス・支点・拘束は並列に置くこと自体に意味があり得る（剛性が加算される）ため、削除しない。
 */
const REDUNDANT_REMOVAL_KINDS: ReadonlySet<DocumentDataKind> = new Set(['beam', 'pillar', 'floor', 'wall', 'bearWall']);

/**
 * 許容距離以内にあるNodeを結合する計画を作る。Documentは変更しない。
 *
 * 次のNodeは結合しない。
 * - 同じ要素から参照され、互いに許容距離以内にある（零長ばねの両端、同位置を結ぶ拘束など、
 *   意図して重ねてあるNode）。これらは他のNodeとも結合しない
 * - 同じ要素が両方を参照している（結合すると零長部材・退化面・自己拘束になる）
 * - 結合すると、参照する要素がモデルの不変条件（部材長、面の平面性など）を満たさなくなる
 * - 双方に質量が設定されている
 * - ロック中のレイヤーに属する、またはロック中の要素から参照されている
 *
 * 残すNodeは、レイヤーの高さにあるNode、面材から参照されているNodeを優先し、
 * 同条件なら Document の並び順（Z, Y, X 昇順）で先に現れる方とする。
 * これにより、わずかにずれたNodeが階の上のNodeを吸収して部材が階から外れることを避ける。
 * その向きでは要素が不正になり、逆向きなら成立する場合に限り、逆向きに結合する。
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
  const elementsOf = (node: Node): Set<DocumentData> => referencing.get(node) ?? EMPTY_ELEMENTS;

  const coincidentByDesign = intentionallyCoincidentNodes(document, tolerance);
  const candidates = document.nodeList.filter(
    (node) =>
      !coincidentByDesign.has(node) &&
      !document.isDataLocked(node) &&
      ![...elementsOf(node)].some((element) => document.isDataLocked(element)),
  );
  const priorityOf = (node: Node): number => {
    const onLayer = document.layers.some((layer) => Math.abs(layer.posZ - node.pos.z) <= LAYER_ELEVATION_TOLERANCE);
    const onPlane = [...elementsOf(node)].some((element) => element instanceof Plane);
    return (onLayer ? 0 : 2) + (onPlane ? 0 : 1);
  };
  const priorities = new Map(candidates.map((node) => [node, priorityOf(node)] as const));
  // Array.prototype.sort は安定なので、同じ優先度では Document の並び順が保たれる。
  const ordered = [...candidates].sort((a, b) => priorities.get(a)! - priorities.get(b)!);

  const cellSize = Math.max(tolerance, 1e-9);
  const cells = new Map<string, Node[]>();
  // 代表Nodeごとに、結合済みNode群を参照する要素と質量の有無を持つ。
  const groupElements = new Map<Node, Set<DocumentData>>();
  const groupHasMass = new Map<Node, boolean>();
  const replacements = new Map<Node, Node>();
  /** 他のNodeを吸収済みの代表。 */
  const absorbing = new Set<Node>();
  const cellKeyOf = (node: Node): string =>
    `${Math.floor(node.pos.x / cellSize)},${Math.floor(node.pos.y / cellSize)},${Math.floor(node.pos.z / cellSize)}`;

  /** node を target へ付け替えても、node を参照する要素が不変条件を満たすか。 */
  const staysValid = (node: Node, target: Node): boolean => {
    const resolve = (item: Node): Node => (item === node ? target : (replacements.get(item) ?? item));
    for (const element of elementsOf(node)) {
      const nodeMap = new Map(element.referencedNodes.map((item) => [item, resolve(item)] as const));
      try {
        const resolved = cloneWithNodes(element, nodeMap);
        ModelValidator.validateModel([...new Set(nodeMap.values()), resolved], [], { validateNumbers: false });
      } catch {
        return false;
      }
    }
    return true;
  };

  for (const node of ordered) {
    const elements = elementsOf(node);
    const cx = Math.floor(node.pos.x / cellSize);
    const cy = Math.floor(node.pos.y / cellSize);
    const cz = Math.floor(node.pos.z / cellSize);
    const nearby: Array<{ target: Node; distance: number }> = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const target of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const distance = target.pos.sub(node.pos).length;
            if (distance <= tolerance) nearby.push({ target, distance });
          }
        }
      }
    }
    nearby.sort((a, b) => a.distance - b.distance);

    let kept: Node | null = null;
    let reversed = false;
    for (const { target } of nearby) {
      if (node.mass && groupHasMass.get(target)) continue;
      const shared = groupElements.get(target)!;
      if ([...elements].some((element) => shared.has(element))) continue;
      if (staysValid(node, target)) {
        kept = target;
        break;
      }
      // 優先度の高い側を残すと要素が不正になる場合は、逆向き（target を node へ寄せる）を試す。
      // 例: 階の高さにある梁端を、わずかに低い床の頂点へ寄せる。床の頂点を1つだけ動かすと平面でなくなる。
      // 既に他のNodeを吸収した代表は、その結合を検証し直す必要があるため対象にしない。
      if (!absorbing.has(target) && staysValid(target, node)) {
        kept = target;
        reversed = true;
        break;
      }
    }

    if (kept && !reversed) {
      replacements.set(node, kept);
      absorbing.add(kept);
      const shared = groupElements.get(kept)!;
      for (const element of elements) shared.add(element);
      if (node.mass) groupHasMass.set(kept, true);
      continue;
    }

    const group = new Set(elements);
    let hasMass = node.mass !== null;
    if (kept) {
      // node を代表にし、これまで代表だった kept を node へ付け替える。
      replacements.set(kept, node);
      absorbing.add(node);
      for (const element of groupElements.get(kept)!) group.add(element);
      hasMass ||= groupHasMass.get(kept) === true;
      groupElements.delete(kept);
      groupHasMass.delete(kept);
      const keptCell = cells.get(cellKeyOf(kept))!;
      keptCell.splice(keptCell.indexOf(kept), 1);
    }

    const key = `${cx},${cy},${cz}`;
    const cell = cells.get(key);
    if (cell) cell.push(node);
    else cells.set(key, [node]);
    groupElements.set(node, group);
    groupHasMass.set(node, hasMass);
  }

  return { replacements, redundantElements: findRedundantElements(document, replacements) };
}

const EMPTY_ELEMENTS: Set<DocumentData> = new Set();

/**
 * 1つの要素から参照され、互いに許容距離以内にあるNode。
 * 零長ばねの両端や同位置を結ぶ拘束のように、別Nodeであること自体がモデルの意味を持つ。
 */
function intentionallyCoincidentNodes(document: Document, tolerance: number): Set<Node> {
  const result = new Set<Node>();
  for (const data of document.allDataList) {
    const nodes = [...new Set(data.referencedNodes)];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].pos.sub(nodes[j].pos).length <= tolerance) {
          result.add(nodes[i]);
          result.add(nodes[j]);
        }
      }
    }
  }
  return result;
}

/** 参照を付け替えた後に、他の要素と種別・参照Node・属性がすべて一致する梁・柱・面材を列挙する。 */
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
    if (!REDUNDANT_REMOVAL_KINDS.has(data.kind)) continue;
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
