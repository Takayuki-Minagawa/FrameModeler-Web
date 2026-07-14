import { DocumentData, type RemovableResult } from './DocumentData';
import { Node } from './Node';
import { Member } from './Member';
import { Plane } from './Plane';
import { Point3D } from '../math/Point3D';
import { Point2D } from '../math/Point2D';
import { Layer } from './Layer';
import { typeOrderIndex, categoryOf, CAD_ID_OFFSET, type NumberCategory } from './typeRegistry';
import type { ImportMetadata, ImportSourceElementInfo, ImportSourceNodeInfo } from './ImportMetadata';
import { ModelValidator } from './ModelValidator';
import { Floor } from './Floor';
import { Wall } from './Wall';

export type DocumentChangeKind = 'model' | 'layers' | 'metadata' | 'reset';

export interface DocumentChangeEvent {
  kind: DocumentChangeKind;
  document: Document;
}

export type DocumentChangeListener = (event: DocumentChangeEvent) => void;

interface DataSnapshot {
  data: DocumentData;
  number: number;
  select: boolean;
  nodePos?: Point3D;
  member?: { nodeI: Node | null; nodeJ: Node | null; section: string; isNodeReverse: boolean };
  plane?: { nodes: Node[]; section: string; weight?: number; direction?: Floor['direction'] };
}

interface DocumentSnapshot {
  dataList: DocumentData[];
  dataStates: DataSnapshot[];
  layers: Layer[];
  layerStates: Array<{ layer: Layer; posZ: number; name: string }>;
  shownLayer: Layer | null;
  filename: string;
  importMetadata: ImportMetadata | null;
}

export class Document {
  private static _instance: Document = new Document();

  private dataList: DocumentData[] = [];
  private _layers: Layer[] = [];
  private _shownLayer: Layer | null = null;
  private _filename: string = '';
  private _importMetadata: ImportMetadata | null = null;
  private readonly changeListeners = new Set<DocumentChangeListener>();
  private transactionDepth = 0;
  private transactionChanged = false;
  private transactionLayersChanged = false;

  /** 変更通知コールバック */
  onChanged: (() => void) | null = null;
  onLayerChanged: (() => void) | null = null;

  private constructor() {}

  static get instance(): Document {
    return Document._instance;
  }

  /** 複数の購読者向け変更通知。戻り値を呼ぶと購読解除する。 */
  subscribe(listener: DocumentChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
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
    this.addMany([data]);
  }

  /** Node とそれを参照する要素を同じ確定単位で追加できる。 */
  addMany(data: ReadonlyArray<DocumentData>): void {
    const additions = data.filter((item, index) => !this.dataList.includes(item) && data.indexOf(item) === index);
    if (additions.length === 0) return;
    this.commitDataCandidate([...this.dataList, ...additions]);
  }

  remove(data: DocumentData): void {
    const idx = this.dataList.indexOf(data);
    if (idx < 0) return;

    // Node は他データからの参照チェックが必要（Member/Plane が参照中なら削除不可）
    const { removable, reason } = data instanceof Node ? this.checkNodeRemovable(data) : data.isRemovable();
    if (!removable) {
      throw new Error('削除できないデータ: ' + reason);
    }

    this.removeMany([data]);
  }

  /** 参照要素とNodeをまとめて削除でき、途中失敗ではDocumentを変更しない。 */
  removeMany(data: ReadonlyArray<DocumentData>): void {
    const removals = new Set(data.filter((item) => this.dataList.includes(item)));
    if (removals.size === 0) return;
    this.commitDataCandidate(this.dataList.filter((item) => !removals.has(item)));
  }

  /**
   * 直接プロパティ更新をatomicに確定する。
   * nested update/addMany/removeMany は最外周で1回だけ検証・採番・通知される。
   */
  update<T>(mutator: () => T): T {
    return this.transaction(mutator);
  }

  /** update の汎用名。例外または検証失敗時は既存オブジェクトの状態も復元する。 */
  transaction<T>(mutator: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth++;
      this.transactionChanged = true;
      try {
        return mutator();
      } finally {
        this.transactionDepth--;
      }
    }

    const snapshot = this.captureSnapshot();
    this.transactionDepth = 1;
    this.transactionChanged = true;
    this.transactionLayersChanged = false;
    let result: T;
    try {
      result = mutator();
      ModelValidator.validateModel(this.dataList, this._layers, { validateNumbers: false });
      this.reindex();
      ModelValidator.validateModel(this.dataList, this._layers);
    } catch (error) {
      this.restoreSnapshot(snapshot);
      this.transactionDepth = 0;
      this.transactionChanged = false;
      this.transactionLayersChanged = false;
      throw error;
    }
    this.transactionDepth = 0;
    this.finishTransaction();
    return result;
  }

  /** ソートと番号再割当を常に一体で行う（不変条件を保証, 5-3） */
  private reindex(): void {
    this.dataList.sort((a, b) => Document.compareData(a, b));
    this.assignNumbers(this.dataList);
  }

  private static compareData(a: DocumentData, b: DocumentData): number {
    const idxA = typeOrderIndex(a);
    const idxB = typeOrderIndex(b);
    if (idxA !== idxB) return idxA - idxB;

    // 同一型バケット内は型固有のcompareTo（未定義型は既定の0で安定）
    return a.compareTo(b);
  }

  private assignNumbers(dataList: ReadonlyArray<DocumentData>): void {
    const counters: Record<NumberCategory, number> = { node: 0, member: 0, plane: 0 };
    for (const data of dataList) {
      const category = categoryOf(data);
      if (category) data.number = counters[category]++;
    }
  }

  private commitDataCandidate(candidate: ReadonlyArray<DocumentData>): void {
    const next = [...candidate];
    ModelValidator.validateModel(next, this._layers, { validateNumbers: false });
    next.sort((a, b) => Document.compareData(a, b));
    this.assignNumbers(next);
    ModelValidator.validateModel(next, this._layers);
    this.dataList = next;
    this.markChanged();
  }

  private markChanged(
    layersChanged: boolean = false,
    kind: DocumentChangeKind = layersChanged ? 'layers' : 'model',
  ): void {
    if (this.transactionDepth > 0) {
      this.transactionChanged = true;
      this.transactionLayersChanged ||= layersChanged;
      return;
    }
    this._importMetadata = null;
    this.notifyChanged(kind);
    if (layersChanged) this.onLayerChanged?.();
  }

  private finishTransaction(): void {
    const changed = this.transactionChanged;
    const layersChanged = this.transactionLayersChanged;
    this.transactionChanged = false;
    this.transactionLayersChanged = false;
    if (!changed) return;
    this._importMetadata = null;
    this.notifyChanged(layersChanged ? 'layers' : 'model');
    if (layersChanged) this.onLayerChanged?.();
  }

  private captureSnapshot(): DocumentSnapshot {
    return {
      dataList: [...this.dataList],
      dataStates: this.dataList.map((data): DataSnapshot => {
        const state: DataSnapshot = { data, number: data.number, select: data.select };
        if (data instanceof Node) state.nodePos = data.pos.clone();
        if (data instanceof Member) {
          state.member = {
            nodeI: data.nodeI,
            nodeJ: data.nodeJ,
            section: data.section,
            isNodeReverse: data.isNodeReverse,
          };
        }
        if (data instanceof Plane) {
          state.plane = {
            nodes: [...data.nodeList],
            section: data.section,
            weight: data instanceof Floor || data instanceof Wall ? data.weight : undefined,
            direction: data instanceof Floor ? data.direction : undefined,
          };
        }
        return state;
      }),
      layers: [...this._layers],
      layerStates: this._layers.map((layer) => ({ layer, posZ: layer.posZ, name: layer.name })),
      shownLayer: this._shownLayer,
      filename: this._filename,
      importMetadata: this._importMetadata,
    };
  }

  private restoreSnapshot(snapshot: DocumentSnapshot): void {
    for (const state of snapshot.dataStates) {
      state.data.number = state.number;
      state.data.select = state.select;
      if (state.data instanceof Node && state.nodePos) state.data.pos = state.nodePos.clone();
      if (state.data instanceof Member && state.member) {
        state.data.nodeI = state.member.nodeI;
        state.data.nodeJ = state.member.nodeJ;
        state.data.section = state.member.section;
        state.data.isNodeReverse = state.member.isNodeReverse;
      }
      if (state.data instanceof Plane && state.plane) {
        state.data.setNodes(state.plane.nodes);
        state.data.section = state.plane.section;
        if (state.data instanceof Floor) {
          state.data.weight = state.plane.weight ?? 0;
          if (state.plane.direction !== undefined) state.data.direction = state.plane.direction;
        } else if (state.data instanceof Wall) {
          state.data.weight = state.plane.weight ?? 0;
        }
      }
    }
    for (const state of snapshot.layerStates) {
      state.layer.posZ = state.posZ;
      state.layer.name = state.name;
    }
    this.dataList = [...snapshot.dataList];
    this._layers = [...snapshot.layers];
    this._shownLayer = snapshot.shownLayer;
    this._filename = snapshot.filename;
    this._importMetadata = snapshot.importMetadata;
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
        if (nodes.every((n) => p.nodeList.includes(n))) return p;
      }
    }
    return null;
  }

  get sceneCenter(): Point3D {
    return Point3D.average(this.nodeList.map((n) => n.pos));
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
    ModelValidator.validateLayers([layer]);
    if (this._layers.some((l) => l.posZ === layer.posZ)) return false;
    const layers = [...this._layers, layer].sort((a, b) => a.compareTo(b));
    ModelValidator.validateLayers(layers);
    this._layers = layers;
    this.markChanged(true);
    return true;
  }

  /** レイヤー名/高さを検証・再整列し、1 transactionとして通知する。 */
  updateLayer(layer: Layer, changes: { name?: string; posZ?: number }): boolean {
    if (!this._layers.includes(layer)) return false;
    this.transaction(() => {
      if (changes.name !== undefined) layer.name = changes.name;
      if (changes.posZ !== undefined) layer.posZ = changes.posZ;
      this._layers.sort((a, b) => a.compareTo(b));
      this.markChanged(true);
    });
    return true;
  }

  removeLayer(layer: Layer): boolean {
    const idx = this._layers.indexOf(layer);
    if (idx < 0) return false;
    this._layers.splice(idx, 1);
    if (this._shownLayer === layer) {
      this._shownLayer = this._layers.length > 0 ? this._layers[0] : null;
    }
    this.markChanged(true);
    return true;
  }

  clearLayers(): void {
    if (this._layers.length === 0 && this._shownLayer === null) return;
    this._layers = [];
    this._shownLayer = null;
    this.markChanged(true);
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

  // ========== Import metadata ==========

  get importMetadata(): ImportMetadata | null {
    return this._importMetadata;
  }

  setImportMetadata(metadata: ImportMetadata | null): void {
    this._importMetadata = metadata;
    this.notifyChanged('metadata');
  }

  getImportSourceNodes(data: DocumentData): ImportSourceNodeInfo[] | undefined {
    return this._importMetadata?.sourceNodes.get(data);
  }

  getImportSourceElements(data: DocumentData): ImportSourceElementInfo[] | undefined {
    return this._importMetadata?.sourceElements.get(data);
  }

  // ========== 初期化 ==========

  init(): void {
    this._filename = '';
    this.dataList = [];
    this._layers = [];
    this._shownLayer = null;
    this._importMetadata = null;
    this.notifyChanged('reset');
    this.onLayerChanged?.();
  }

  /** 外部からデータ一括設定（JSON読込用） */
  bulkLoad(data: ReadonlyArray<DocumentData>, layers: ReadonlyArray<Layer>): void {
    // 呼出元の配列を保持せず、検証完了後だけ現行モデルを置換する。
    const candidateData = [...data];
    const candidateLayers = [...layers].sort((a, b) => a.compareTo(b));
    ModelValidator.validateModel(candidateData, candidateLayers, { validateNumbers: false });
    candidateData.sort((a, b) => Document.compareData(a, b));
    this.assignNumbers(candidateData);
    ModelValidator.validateModel(candidateData, candidateLayers);

    this.dataList = candidateData;
    this._layers = candidateLayers;
    this._shownLayer = candidateLayers.length > 0 ? candidateLayers[0] : null;
    this.markChanged(true, 'model');
  }

  private notifyChanged(kind: DocumentChangeKind = 'model'): void {
    this.onChanged?.();
    const event: DocumentChangeEvent = { kind, document: this };
    for (const listener of [...this.changeListeners]) listener(event);
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
