import { Constraint } from './Constraint';
import { Document } from './Document';
import type { DocumentData } from './DocumentData';
import type { Layer } from './Layer';
import { Member } from './Member';
import { Node } from './Node';
import { Plane } from './Plane';
import { Support } from './Support';
import { Spring } from './Spring';
import { Truss } from './Truss';
import { Floor } from './Floor';
import { Wall } from './Wall';
import { Point3D } from '../math/Point3D';
import { cloneWithNodes } from '../io/DocumentDataCodecRegistry';

const Z_TOLERANCE = 1e-6;

/**
 * source階の平面内データをtarget階へ全codec共通の複製規則でコピーする。
 * 柱・壁など階間にまたがる要素は意図せぬ二重化を避けるため対象外とする。
 */
export function copyLayerContents(source: Layer, target: Layer, document: Document = Document.instance): void {
  if (source === target) return;
  if (target.locked) throw new Error(`Cannot copy elements to locked layer '${target.name}'`);
  const sourceNodes = document.nodeList.filter((node) => onElevation(node, source.posZ));
  const nodeMap = new Map<Node, Node>();
  const claimedTargetNodes = new Set<Node>();
  const additions: DocumentData[] = [];

  for (const sourceNode of sourceNodes) {
    const targetPosition = new Point3D(sourceNode.pos.x, sourceNode.pos.y, target.posZ);
    // Coincident source nodes can be topologically distinct (zero-length
    // springs). Reuse target nodes one-to-one instead of collapsing every
    // source node at the same coordinate onto the first match.
    const existing = document.nodeList.find(
      (node) => !claimedTargetNodes.has(node) && node.pos.sub(targetPosition).length <= Z_TOLERANCE,
    );
    if (existing) {
      nodeMap.set(sourceNode, existing);
      claimedTargetNodes.add(existing);
      continue;
    }
    const copy = cloneWithNodes(sourceNode, nodeMap);
    copy.pos = targetPosition;
    additions.push(copy);
  }

  const candidates = document.allDataList.filter(
    (data) => !(data instanceof Node) && referencesOf(data).every((node) => nodeMap.has(node)),
  );
  for (const data of candidates) {
    const copy = cloneWithNodes(data, nodeMap);
    if (!hasEquivalent(document.allDataList, additions, copy)) additions.push(copy);
  }

  if (additions.length > 0) document.addMany(additions);
}

function referencesOf(data: DocumentData): Node[] {
  if (data instanceof Member) return data.nodeI && data.nodeJ ? [data.nodeI, data.nodeJ] : [];
  if (data instanceof Plane) return [...data.nodeList];
  if (data instanceof Support) return data.node ? [data.node] : [];
  if (data instanceof Constraint) {
    return [data.slaveNode, ...data.terms.map((term) => term.node)].filter((node): node is Node => node !== null);
  }
  return [];
}

function hasEquivalent(
  current: ReadonlyArray<DocumentData>,
  additions: ReadonlyArray<DocumentData>,
  candidate: DocumentData,
): boolean {
  return [...current, ...additions].some((data) => {
    if (data.kind !== candidate.kind) return false;
    if (data instanceof Member && candidate instanceof Member) {
      return membersEquivalent(data, candidate);
    }
    if (data instanceof Plane && candidate instanceof Plane) {
      return planesEquivalent(data, candidate);
    }
    if (data instanceof Support && candidate instanceof Support) {
      return data.node === candidate.node && sameStrings(data.fixedDofs, candidate.fixedDofs);
    }
    if (data instanceof Constraint && candidate instanceof Constraint) {
      return (
        data.slaveNode === candidate.slaveNode &&
        data.slaveDof === candidate.slaveDof &&
        data.terms.length === candidate.terms.length &&
        candidate.terms.every((term, index) => {
          const other = data.terms[index];
          return other?.node === term.node && other.dof === term.dof && other.coefficient === term.coefficient;
        })
      );
    }
    return false;
  });
}

function membersEquivalent(first: Member, second: Member): boolean {
  if (
    first.nodeI !== second.nodeI ||
    first.nodeJ !== second.nodeJ ||
    first.section !== second.section ||
    first.isNodeReverse !== second.isNodeReverse
  ) {
    return false;
  }
  if (first instanceof Truss && second instanceof Truss) {
    return (
      first.material === second.material &&
      first.area === second.area &&
      first.areaUnit === second.areaUnit &&
      first.elasticModulus === second.elasticModulus &&
      first.stressUnit === second.stressUnit
    );
  }
  if (first instanceof Spring && second instanceof Spring) {
    return (
      first.components.length === second.components.length &&
      first.components.every((component, index) => {
        const other = second.components[index];
        return component.dof === other?.dof && component.stiffness === other.stiffness && component.unit === other.unit;
      }) &&
      samePoint(first.orientX, second.orientX) &&
      samePoint(first.orientY, second.orientY) &&
      samePair(first.shearDistance, second.shearDistance) &&
      first.note === second.note
    );
  }
  return true;
}

function planesEquivalent(first: Plane, second: Plane): boolean {
  if (
    first.nodeCount !== second.nodeCount ||
    first.nodeList.some((node, index) => node !== second.nodeList[index]) ||
    first.section !== second.section
  ) {
    return false;
  }
  if (first instanceof Floor && second instanceof Floor) {
    return first.weight === second.weight && first.direction === second.direction;
  }
  if (first instanceof Wall && second instanceof Wall) return first.weight === second.weight;
  return true;
}

function samePoint(first: Point3D | null, second: Point3D | null): boolean {
  return first === null || second === null
    ? first === second
    : first.x === second.x && first.y === second.y && first.z === second.z;
}

function samePair(first: readonly [number, number] | null, second: readonly [number, number] | null): boolean {
  return first === null || second === null ? first === second : first[0] === second[0] && first[1] === second[1];
}

function sameStrings(first: ReadonlyArray<string>, second: ReadonlyArray<string>): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function onElevation(node: Node, elevation: number): boolean {
  return Math.abs(node.pos.z - elevation) <= Z_TOLERANCE;
}
