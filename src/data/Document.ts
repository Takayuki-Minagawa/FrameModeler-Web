import { DocumentData } from './DocumentData';
import { Node } from './Node';
import { Member } from './Member';
import { Beam } from './Beam';
import { Pillar } from './Pillar';
import { Plane } from './Plane';
import { Floor } from './Floor';
import { Wall } from './Wall';
import { BearWall } from './BearWall';
import { Point3D } from '../math/Point3D';
import { Point2D } from '../math/Point2D';
import { Layer } from '../ui/Layer';

/** データ型の優先順位 */
const TYPE_ORDER: Function[] = [
  Node, Beam, Pillar, BearWall, Wall, Floor,
];

export class Document {
  private static _instance: Document = new Document();

  private dataList: DocumentData[] = [];
  private _layers: Layer[] = [];
  private _shownLayer: Layer | null = null;
  private _filename: string = '';
  private suppressDataSort: boolean = false;

  /** 変更通知コールバック */
  onChanged: (() => void) | null = null;
  onLayerChanged: (() => void) | null = null;

  private constructor() {}

  static get instance(): Document {
    return Document._instance;
  }

  // ========== データリストアクセス ==========

  chooseData<T>(type: Function): T[] {
    return this.dataList.filter(d => d instanceof type) as unknown as T[];
  }

  get allDataList(): ReadonlyArray<DocumentData> {
    return this.dataList;
  }

  get nodeList(): Node[] {
    return this.chooseData<Node>(Node);
  }

  get memberList(): Member[] {
    return this.chooseData<Member>(Member);
  }

  get planeList(): Plane[] {
    return this.chooseData<Plane>(Plane);
  }

  // ========== データ追加/削除 ==========

  add(data: DocumentData): void {
    if (this.dataList.includes(data)) return;
    this.dataList.push(data);
    if (!this.suppressDataSort) {
      this.sortDataList();
      this.assignNumbers();
    }
    this.notifyChanged();
  }

  remove(data: DocumentData): void {
    const idx = this.dataList.indexOf(data);
    if (idx < 0) return;

    const { removable, reason } = data.isRemovable();
    if (!removable) {
      throw new Error('削除できないデータ: ' + reason);
    }

    this.dataList.splice(idx, 1);
    if (!this.suppressDataSort) {
      this.sortDataList();
      this.assignNumbers();
    }
    this.notifyChanged();
  }

  private sortDataList(): void {
    this.dataList.sort((a, b) => Document.compareData(a, b));
  }

  private static compareData(a: DocumentData, b: DocumentData): number {
    const typeIndexA = TYPE_ORDER.findIndex(t => a instanceof t);
    const typeIndexB = TYPE_ORDER.findIndex(t => b instanceof t);
    const idxA = typeIndexA >= 0 ? typeIndexA : TYPE_ORDER.length;
    const idxB = typeIndexB >= 0 ? typeIndexB : TYPE_ORDER.length;

    if (idxA !== idxB) return idxA - idxB;

    // 同じ型なら型固有のcompareTo
    if (a instanceof Node && b instanceof Node) return a.compareTo(b);
    if (a instanceof Beam && b instanceof Beam) return a.compareTo(b);
    if (a instanceof Pillar && b instanceof Pillar) return a.compareTo(b);
    if (a instanceof Floor && b instanceof Floor) return a.compareTo(b);
    return 0;
  }

  private assignNumbers(): void {
    let nodeNum = 0;
    let memberNum = 0;
    let planeNum = 0;

    for (const data of this.dataList) {
      if (data instanceof Node) data.number = nodeNum++;
      else if (data instanceof Member) data.number = memberNum++;
      else if (data instanceof Plane) data.number = planeNum++;
    }
  }

  // ========== 検索 ==========

  getNodeAt(p: Point3D, range: number = 0.5): Node | null {
    for (const n of this.nodeList) {
      if (n.pos.sub(p).length <= range) return n;
    }
    return null;
  }

  getNodeByNumber(num: number): Node | null {
    for (const n of this.nodeList) {
      if (n.number === num) return n;
    }
    return null;
  }

  /** 直上のNodeを検索（柱配置用） */
  getNodeAbove(p: Point3D): Node | null {
    const abovePos = this.getPosAbove(p);
    if (!abovePos) return null;

    let node = this.getNodeAt(abovePos);
    if (!node) {
      node = new Node(abovePos);
      this.add(node);
    }
    return node;
  }

  /** 直上の位置を検索（Node or 部材交点） */
  getPosAbove(p: Point3D): Point3D | null {
    let minDist = Number.MAX_VALUE;

    // Node検索
    let aboveNode: Node | null = null;
    for (const n of this.nodeList) {
      if (n.pos.x === p.x && n.pos.y === p.y) {
        const dist = n.pos.z - p.z;
        if (dist > 0 && dist < minDist) {
          aboveNode = n;
          minDist = dist;
        }
      }
    }
    if (aboveNode) return aboveNode.pos.clone();

    // 部材交点検索
    let abovePos: Point3D | null = null;
    for (const m of this.memberList) {
      const i = m.posI.toPointXY();
      const j = m.posJ.toPointXY();
      const d1 = j.sub(i);
      const d2 = p.toPointXY().sub(i);
      const d1n = d1.getNormalized();
      const d2n = d2.getNormalized();
      if (Point2D.dotProduct(d1n, d2n) > 0.999) {
        const d1len = d1.length;
        const d2len = d2.length;
        if (d1len > d2len) {
          const t = d2len / d1len;
          const dir = m.posJ.sub(m.posI);
          const intersect = m.posI.add(dir.scale(t));
          const dist = intersect.z - p.z;
          if (dist > 0 && dist < minDist) {
            abovePos = intersect;
            minDist = dist;
          }
        }
      }
    }
    return abovePos;
  }

  getMemberOf(i: Node, j: Node): Member | null {
    for (const m of this.memberList) {
      if ((m.nodeI === i && m.nodeJ === j) || (m.nodeI === j && m.nodeJ === i)) {
        return m;
      }
    }
    return null;
  }

  getPlaneOf(nodes: Node[]): Plane | null {
    for (const p of this.planeList) {
      if (p.nodeCount === nodes.length) {
        if (nodes.every(n => p.nodeList.includes(n))) return p;
      }
    }
    return null;
  }

  get sceneCenter(): Point3D {
    const nodes = this.nodeList;
    if (nodes.length === 0) return new Point3D();
    let sum = new Point3D();
    for (const n of nodes) sum = sum.add(n.pos);
    return sum.div(nodes.length);
  }

  // ========== CAD ID ==========

  readonly nodeCadIdOffset = 0;
  readonly memberCadIdOffset = 100000;
  readonly planeCadIdOffset = 200000;

  // ========== レイヤー ==========

  get layers(): ReadonlyArray<Layer> {
    return this._layers;
  }

  get shownLayer(): Layer | null {
    return this._shownLayer;
  }

  set shownLayer(layer: Layer | null) {
    this._shownLayer = layer;
    this.onLayerChanged?.();
  }

  addLayer(layer: Layer): boolean {
    if (this._layers.some(l => l.posZ === layer.posZ)) return false;
    this._layers.push(layer);
    this._layers.sort((a, b) => a.compareTo(b));
    this.onLayerChanged?.();
    return true;
  }

  removeLayer(layer: Layer): boolean {
    const idx = this._layers.indexOf(layer);
    if (idx < 0) return false;
    this._layers.splice(idx, 1);
    if (this._shownLayer === layer) {
      this._shownLayer = this._layers.length > 0 ? this._layers[0] : null;
    }
    this.onLayerChanged?.();
    return true;
  }

  clearLayers(): void {
    this._layers = [];
    this._shownLayer = null;
    this.onLayerChanged?.();
  }

  // ========== ファイル ==========

  get filename(): string {
    return this._filename;
  }

  set filename(value: string) {
    this._filename = value;
  }

  get hasFileName(): boolean {
    return this._filename !== '';
  }

  // ========== 初期化 ==========

  init(): void {
    this._filename = '';
    this.dataList = [];
    this._layers = [];
    this._shownLayer = null;
    this.notifyChanged();
    this.onLayerChanged?.();
  }

  /** 外部からデータ一括設定（XML読込用） */
  bulkLoad(data: DocumentData[], layers: Layer[]): void {
    this.suppressDataSort = true;
    this.dataList = data;
    this.suppressDataSort = false;
    this.sortDataList();
    this.assignNumbers();

    this._layers = layers.sort((a, b) => a.compareTo(b));
    this._shownLayer = this._layers.length > 0 ? this._layers[0] : null;

    this.notifyChanged();
    this.onLayerChanged?.();
  }

  private notifyChanged(): void {
    this.onChanged?.();
  }

  /** Node削除可能チェック用: 参照元があるかチェック */
  checkNodeRemovable(node: Node): { removable: boolean; reason: string } {
    for (const data of this.dataList) {
      if (data instanceof Member && data.isReferring(node)) {
        return { removable: false, reason: '他のデータから参照されているノードは削除できません' };
      }
      if (data instanceof Plane && data.isReferring(node)) {
        return { removable: false, reason: '他のデータから参照されているノードは削除できません' };
      }
    }
    return { removable: true, reason: '' };
  }
}
