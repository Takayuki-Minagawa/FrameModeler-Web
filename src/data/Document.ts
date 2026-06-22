import { DocumentData, type RemovableResult } from './DocumentData';
import { Node } from './Node';
import { Member } from './Member';
import { Plane } from './Plane';
import { Point3D } from '../math/Point3D';
import { Point2D } from '../math/Point2D';
import { Layer } from '../ui/Layer';
import { typeOrderIndex, categoryOf, CAD_ID_OFFSET, type NumberCategory } from './typeRegistry';

export class Document {
  private static _instance: Document = new Document();

  private dataList: DocumentData[] = [];
  private _layers: Layer[] = [];
  private _shownLayer: Layer | null = null;
  private _filename: string = '';

  /** 変更通知コールバック */
  onChanged: (() => void) | null = null;
  onLayerChanged: (() => void) | null = null;

  private constructor() {}

  static get instance(): Document {
    return Document._instance;
  }

  // ========== データリストアクセス ==========

  chooseData<T extends DocumentData>(type: abstract new (...args: any[]) => T): T[] {
    return this.dataList.filter((d): d is T => d instanceof type);
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
    this.reindex();
    this.notifyChanged();
  }

  remove(data: DocumentData): void {
    const idx = this.dataList.indexOf(data);
    if (idx < 0) return;

    // Node は他データからの参照チェックが必要（Member/Plane が参照中なら削除不可）
    const { removable, reason } = data instanceof Node
      ? this.checkNodeRemovable(data)
      : data.isRemovable();
    if (!removable) {
      throw new Error('削除できないデータ: ' + reason);
    }

    this.dataList.splice(idx, 1);
    this.reindex();
    this.notifyChanged();
  }

  /** ソートと番号再割当を常に一体で行う（不変条件を保証, 5-3） */
  private reindex(): void {
    this.dataList.sort((a, b) => Document.compareData(a, b));
    this.assignNumbers();
  }

  private static compareData(a: DocumentData, b: DocumentData): number {
    const idxA = typeOrderIndex(a);
    const idxB = typeOrderIndex(b);
    if (idxA !== idxB) return idxA - idxB;

    // 同一型バケット内は型固有のcompareTo（未定義型は既定の0で安定）
    return a.compareTo(b);
  }

  private assignNumbers(): void {
    const counters: Record<NumberCategory, number> = { node: 0, member: 0, plane: 0 };
    for (const data of this.dataList) {
      const category = categoryOf(data);
      if (category) data.number = counters[category]++;
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

  /** 指定座標のNodeを取得。無ければ生成して追加する */
  getOrCreateNode(pos: Point3D): Node {
    let node = this.getNodeAt(pos);
    if (!node) {
      node = new Node(pos);
      this.add(node);
    }
    return node;
  }

  /** 直上のNodeを取得。位置が見つかれば（無ければ生成して）返す（柱配置用） */
  getOrCreateNodeAbove(p: Point3D): Node | null {
    const abovePos = this.getPosAbove(p);
    if (!abovePos) return null;
    return this.getOrCreateNode(abovePos);
  }

  /** 直上の位置を検索（Node優先、無ければ部材交点）（D-10） */
  getPosAbove(p: Point3D): Point3D | null {
    return this.findNodeAbove(p) ?? this.findMemberIntersectionAbove(p);
  }

  /** 同一XYで最も近い上方のNode位置 */
  private findNodeAbove(p: Point3D): Point3D | null {
    let minDist = Number.MAX_VALUE;
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
    return aboveNode ? aboveNode.pos.clone() : null;
  }

  /** pを始点とする鉛直線が交わる、最も近い上方の部材交点 */
  private findMemberIntersectionAbove(p: Point3D): Point3D | null {
    let minDist = Number.MAX_VALUE;
    let abovePos: Point3D | null = null;
    for (const m of this.memberList) {
      const i = m.posI.toPointXY();
      const j = m.posJ.toPointXY();
      const d1 = j.sub(i);
      const d2 = p.toPointXY().sub(i);
      const d1n = d1.getNormalized();
      const d2n = d2.getNormalized();
      if (Point2D.dotProduct(d1n, d2n) > Document.COLLINEAR_THRESHOLD) {
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

  /** 共線判定のしきい値（正規化ベクトルの内積） */
  private static readonly COLLINEAR_THRESHOLD = 0.999;

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
    return Point3D.average(this.nodeList.map(n => n.pos));
  }

  // ========== CAD ID ==========

  readonly nodeCadIdOffset = CAD_ID_OFFSET.node;
  readonly memberCadIdOffset = CAD_ID_OFFSET.member;
  readonly planeCadIdOffset = CAD_ID_OFFSET.plane;

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

  /** 外部からデータ一括設定（JSON読込用） */
  bulkLoad(data: DocumentData[], layers: Layer[]): void {
    this.dataList = data;
    this.reindex();

    // posZ 重複レイヤーを除外（addLayer と同じ不変条件を保つ, I-8）
    const seenPosZ = new Set<number>();
    this._layers = layers
      .filter((l) => (seenPosZ.has(l.posZ) ? false : (seenPosZ.add(l.posZ), true)))
      .sort((a, b) => a.compareTo(b));
    this._shownLayer = this._layers.length > 0 ? this._layers[0] : null;

    this.notifyChanged();
    this.onLayerChanged?.();
  }

  private notifyChanged(): void {
    this.onChanged?.();
  }

  /** Node削除可能チェック用: 参照元があるかチェック */
  checkNodeRemovable(node: Node): RemovableResult {
    for (const data of this.dataList) {
      if ((data instanceof Member || data instanceof Plane) && data.isReferring(node)) {
        return { removable: false, reason: '他のデータから参照されているノードは削除できません' };
      }
    }
    return { removable: true, reason: '' };
  }
}
