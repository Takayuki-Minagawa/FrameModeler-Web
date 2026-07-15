import { Beam } from './Beam';
import type { Document } from './Document';
import type { DocumentData } from './DocumentData';
import { Member } from './Member';
import { collectModelErrors, ModelValidator } from './ModelValidator';
import { Node } from './Node';
import { Plane } from './Plane';
import { Support } from './Support';
import { Constraint } from './Constraint';

export type ModelIssueSeverity = 'error' | 'warning';

export interface ModelIssue {
  severity: ModelIssueSeverity;
  code: string;
  path?: string;
  messageJa: string;
  messageEn: string;
  targets: ReadonlyArray<DocumentData>;
}

/** 保存を阻害する不変条件エラーと、作図上確認すべき警告を非破壊で収集する。 */
export function inspectModel(doc: Document): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const allData = [...doc.allDataList];

  for (const validation of collectModelErrors(allData, doc.layers)) {
    issues.push({
      severity: 'error',
      code: 'MODEL_INVALID',
      path: validation.path,
      messageJa: `モデル不変条件に違反しています（${validation.path}）。該当する値または参照関係を確認してください。`,
      messageEn: `The model violates an invariant: ${validation.message}`,
      targets: targetFromPath(allData, validation.path),
    });
  }

  const nodes = allData.filter((data): data is Node => data instanceof Node);
  const members = allData.filter((data): data is Member => data instanceof Member);
  const planes = allData.filter((data): data is Plane => data instanceof Plane);
  const supports = allData.filter((data): data is Support => data instanceof Support);
  const constraints = allData.filter((data): data is Constraint => data instanceof Constraint);
  const referencedNodes = new Set<Node>();
  members.forEach((member) => {
    if (member.nodeI) referencedNodes.add(member.nodeI);
    if (member.nodeJ) referencedNodes.add(member.nodeJ);
  });
  planes.forEach((plane) => plane.nodeList.forEach((node) => referencedNodes.add(node)));
  supports.forEach((support) => {
    if (support.node) referencedNodes.add(support.node);
  });
  constraints.forEach((constraint) => {
    if (constraint.slaveNode) referencedNodes.add(constraint.slaveNode);
    constraint.terms.forEach((term) => referencedNodes.add(term.node));
  });

  const orphanNodes = nodes.filter((node) => !referencedNodes.has(node));
  if (orphanNodes.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'ORPHAN_NODE',
      messageJa: `どの要素からも参照されていない節点が${orphanNodes.length}件あります。`,
      messageEn: `${orphanNodes.length} node(s) are not referenced by any element.`,
      targets: orphanNodes,
    });
  }

  for (const group of grouped(nodes, coordinateKey)) {
    if (group.length < 2) continue;
    issues.push({
      severity: 'warning',
      code: 'DUPLICATE_NODE_COORDINATE',
      messageJa: `同一座標に${group.length}個の節点があります (${group[0].pos.toString()})。`,
      messageEn: `${group.length} nodes share coordinate ${group[0].pos.toString()}.`,
      targets: group,
    });
  }

  for (const group of grouped(members, memberKey)) {
    if (group.length < 2) continue;
    issues.push({
      severity: 'warning',
      code: 'DUPLICATE_MEMBER',
      messageJa: `同じ端点を結ぶ同種部材が${group.length}件あります。`,
      messageEn: `${group.length} members of the same type connect the same endpoints.`,
      targets: group,
    });
  }

  const missingSection = [...members, ...planes].filter(
    (data) => typeof data.section === 'string' && data.section.trim() === '',
  );
  if (missingSection.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_SECTION',
      messageJa: `断面が未設定の要素が${missingSection.length}件あります。`,
      messageEn: `${missingSection.length} element(s) have no section assigned.`,
      targets: missingSection,
    });
  }

  if (doc.layers.length > 0) {
    const withoutLayer = nodes.filter(
      (node) =>
        !doc.layers.some((layer) => Math.abs(layer.posZ - node.pos.z) <= ModelValidator.PLANAR_ABSOLUTE_TOLERANCE),
    );
    if (withoutLayer.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'NODE_OUTSIDE_LAYER',
        messageJa: `登録レイヤーと同じ高さにない節点が${withoutLayer.length}件あります。`,
        messageEn: `${withoutLayer.length} node(s) do not lie on a registered layer elevation.`,
        targets: withoutLayer,
      });
    }
  }

  const slopedBeams = members.filter(
    (member) =>
      member instanceof Beam &&
      member.nodeI !== null &&
      member.nodeJ !== null &&
      Math.abs(member.nodeI.pos.z - member.nodeJ.pos.z) > ModelValidator.PLANAR_ABSOLUTE_TOLERANCE,
  );
  if (slopedBeams.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'CROSS_LEVEL_BEAM',
      messageJa: `異なる高さの節点を結ぶ梁が${slopedBeams.length}件あります。意図した勾配梁か確認してください。`,
      messageEn: `${slopedBeams.length} beam(s) connect nodes at different elevations; confirm that they are intentional.`,
      targets: slopedBeams,
    });
  }

  const hasAnalysisEntities = allData.some(
    (data) => data.kind === 'truss' || data.kind === 'spring' || data.kind === 'constraint' || data.kind === 'support',
  );
  if (hasAnalysisEntities && supports.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'NO_SUPPORTS',
      messageJa: '解析要素がありますが支点がありません。剛体モードを拘束できるか確認してください。',
      messageEn: 'The model has analysis entities but no supports; verify that rigid-body modes are restrained.',
      targets: [],
    });
  }

  const metadata = doc.importMetadata;
  if (metadata) {
    const dataSet = new Set(allData);
    const staleTargets = [...metadata.sourceNodes.keys(), ...metadata.sourceElements.keys()].filter(
      (data, index, values) => !dataSet.has(data) && values.indexOf(data) === index,
    );
    if (staleTargets.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'STALE_IMPORT_PROVENANCE',
        messageJa: `YAML由来情報に現在のモデルに存在しない参照が${staleTargets.length}件あります。`,
        messageEn: `YAML provenance contains ${staleTargets.length} stale model reference(s).`,
        targets: [],
      });
    }
  }

  return issues;
}

function grouped<T>(items: ReadonlyArray<T>, keyOf: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

function coordinateKey(node: Node): string {
  return `${node.pos.x}\u0000${node.pos.y}\u0000${node.pos.z}`;
}

function memberKey(member: Member): string {
  const i = member.nodeI?.number ?? -1;
  const j = member.nodeJ?.number ?? -1;
  return `${member.kind}\u0000${Math.min(i, j)}\u0000${Math.max(i, j)}`;
}

function targetFromPath(allData: ReadonlyArray<DocumentData>, path?: string): DocumentData[] {
  const dataMatch = /^data\[(\d+)]/.exec(path ?? '');
  if (dataMatch) {
    const target = allData[Number(dataMatch[1])];
    return target ? [target] : [];
  }
  const nodeMatch = /^nodes\[(\d+)]/.exec(path ?? '');
  if (!nodeMatch) return [];
  const target = allData.filter((data): data is Node => data instanceof Node)[Number(nodeMatch[1])];
  return target ? [target] : [];
}
