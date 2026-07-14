import type { Document } from '../data/Document';
import type { DocumentData } from '../data/DocumentData';
import type { Layer } from '../data/Layer';
import { Node } from '../data/Node';
import type { Point3D } from '../math/Point3D';
import type { DocumentCommand } from './DocumentCommand';

export class AddElementsCommand implements DocumentCommand {
  readonly label: string;

  constructor(
    private readonly elements: ReadonlyArray<DocumentData>,
    label: string = '要素追加',
  ) {
    this.label = label;
  }

  execute(document: Document): void {
    assertUnlocked(document, this.elements, this.label);
    document.addMany(this.elements);
  }
}

export class DeleteSelectionCommand implements DocumentCommand {
  readonly label: string;

  constructor(
    private readonly elements: ReadonlyArray<DocumentData>,
    label: string = '選択要素削除',
  ) {
    this.label = label;
  }

  execute(document: Document): void {
    assertUnlocked(document, this.elements, this.label);
    document.removeMany(this.elements);
  }
}

export class MoveNodesCommand implements DocumentCommand {
  readonly label: string;
  private readonly positions: ReadonlyArray<readonly [Node, Point3D]>;

  constructor(positions: Iterable<readonly [Node, Point3D]>, label: string = '節点移動') {
    this.positions = [...positions].map(([node, position]) => [node, position.clone()] as const);
    this.label = label;
  }

  execute(document: Document): void {
    for (const [node] of this.positions) {
      if (!document.allDataList.includes(node)) {
        throw new Error('MoveNodesCommand target does not belong to this Document');
      }
    }
    const nodes = this.positions.map(([node]) => node);
    const affected = affectedByNodeChanges(document, nodes);
    assertUnlocked(document, affected, this.label);
    for (const [node, position] of this.positions) node.pos = position.clone();
    // 移動先がロック階に入る操作も同じtransaction内で拒否し、元位置へrollbackする。
    assertUnlocked(document, affected, this.label);
  }
}

export class UpdatePropertiesCommand<T extends DocumentData> implements DocumentCommand {
  constructor(
    readonly label: string,
    private readonly target: T,
    private readonly applyChanges: (target: T) => void,
  ) {}

  execute(document: Document): void {
    if (!document.allDataList.includes(this.target)) {
      throw new Error('UpdatePropertiesCommand target does not belong to this Document');
    }
    const affected = this.target instanceof Node ? affectedByNodeChanges(document, [this.target]) : [this.target];
    assertUnlocked(document, affected, this.label);
    this.applyChanges(this.target);
    assertUnlocked(document, affected, this.label);
  }
}

export class UpdateLayersCommand implements DocumentCommand {
  constructor(
    readonly label: string,
    private readonly applyChanges: (document: Document) => void,
  ) {}

  execute(document: Document): void {
    this.applyChanges(document);
  }
}

export class ImportCommand<TResult = void> implements DocumentCommand<TResult> {
  constructor(
    readonly label: string,
    private readonly commitImport: (document: Document) => TResult,
  ) {}

  execute(document: Document): TResult {
    return this.commitImport(document);
  }
}

export class AddLayerCommand implements DocumentCommand<boolean> {
  readonly label = 'レイヤー追加';

  constructor(private readonly layer: Layer) {}

  execute(document: Document): boolean {
    return document.addLayer(this.layer);
  }
}

/** UI Commandからロック階のモデル要素を変更しないための共通境界。 */
function assertUnlocked(document: Document, elements: ReadonlyArray<DocumentData>, action: string): void {
  const locked = elements.find((element) => document.isDataLocked(element));
  if (!locked) return;
  throw new Error(`${action}: locked layer contains ${locked.typeText} ${locked.number}`);
}

function affectedByNodeChanges(document: Document, nodes: ReadonlyArray<Node>): DocumentData[] {
  const nodeSet = new Set(nodes);
  return document.allDataList.filter(
    (element) => nodeSet.has(element as Node) || nodes.some((node) => refersToNode(element, node)),
  );
}

function refersToNode(element: DocumentData, node: Node): boolean {
  const candidate = element as DocumentData & { isReferring?: (target: Node) => boolean };
  return typeof candidate.isReferring === 'function' && candidate.isReferring(node);
}
