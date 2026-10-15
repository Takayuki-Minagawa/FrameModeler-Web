import type { DocumentData, DocumentDataKind } from '../data/DocumentData';
import type { HistoryMessageKey, MessageKey } from '../i18n';
import { SelectionFilter } from '../selection/SelectionFilter';
import type { CadView } from '../ui/CadView';
import { AddBeamHandler } from '../ui/handlers/AddBeamHandler';
import { AddBearWallHandler } from '../ui/handlers/AddBearWallHandler';
import { AddFloorHandler } from '../ui/handlers/AddFloorHandler';
import { AddNodeHandler } from '../ui/handlers/AddNodeHandler';
import { AddPillarHandler } from '../ui/handlers/AddPillarHandler';
import { AddWallHandler } from '../ui/handlers/AddWallHandler';
import type { ICadMouseHandler, LayerAboveRequest } from '../ui/handlers/ICadMouseHandler';
import { MeasureHandler } from '../ui/handlers/MeasureHandler';
import { MoveNodeHandler } from '../ui/handlers/MoveNodeHandler';
import { SelectionHandler } from '../ui/handlers/SelectionHandler';

/** ツールバーの並び順。数字キー 1〜9 のショートカットはこの順に対応する。 */
export const TOOL_BUTTON_IDS = [
  'btn-select',
  'btn-move',
  'btn-add-node',
  'btn-add-beam',
  'btn-add-pillar',
  'btn-add-floor',
  'btn-add-wall',
  'btn-add-bearwall',
  'btn-measure',
] as const;

export type ToolButtonId = (typeof TOOL_BUTTON_IDS)[number];

/** ツール名のステータス表示などに使う、ボタンIDと文言キーの対応。 */
export const TOOL_LABEL_KEYS: Readonly<Record<ToolButtonId, MessageKey>> = {
  'btn-select': 'select',
  'btn-move': 'move',
  'btn-add-node': 'node',
  'btn-add-beam': 'beam',
  'btn-add-pillar': 'pillar',
  'btn-add-floor': 'floor',
  'btn-add-wall': 'wall',
  'btn-add-bearwall': 'bearwall',
  'btn-measure': 'measure',
};

export interface ToolControllerHooks {
  /** 要素作成直後にプロパティダイアログを開くか。省略時は常に開く。 */
  shouldOpenProperties?: () => boolean;
  /** 新規要素の既定断面。 */
  defaultSection?: (kind: DocumentDataKind) => string;
  /** 上階レイヤーが無いときの作成依頼。 */
  requestLayerAbove?: LayerAboveRequest;
  /** ツールが切り替わったとき。 */
  onToolChanged?: (id: ToolButtonId) => void;
}

/** 作図ツールの生成、切替、途中操作破棄をmainから分離する。 */
export class ToolController {
  readonly selectionFilter = new SelectionFilter();
  private activeToolId: ToolButtonId = 'btn-select';
  private readonly factories: Record<ToolButtonId, () => ICadMouseHandler>;

  constructor(
    private readonly cadView: CadView,
    private readonly showDataDialog: (data: DocumentData) => void,
    private readonly root: Document = document,
    private readonly hooks: ToolControllerHooks = {},
  ) {
    this.factories = {
      'btn-select': () => new SelectionHandler(this.selectionFilter),
      'btn-move': () => new MoveNodeHandler(this.selectionFilter),
      'btn-add-node': () => new AddNodeHandler(),
      'btn-add-beam': () => new AddBeamHandler(),
      'btn-add-pillar': () => new AddPillarHandler(),
      'btn-add-floor': () => new AddFloorHandler(),
      'btn-add-wall': () => new AddWallHandler(),
      'btn-add-bearwall': () => new AddBearWallHandler(),
      'btn-measure': () => new MeasureHandler(),
    };
  }

  connectToolbar(): void {
    for (const id of TOOL_BUTTON_IDS) {
      this.root.getElementById(id)?.addEventListener('click', () => this.activate(id));
    }
    this.activate('btn-select');
  }

  activate(id: ToolButtonId): void {
    this.cadView.handler?.onDeactivate?.(this.cadView);
    this.activeToolId = id;
    this.cadView.handler = this.createHandler(id);
    this.root.querySelectorAll('.tool-btn').forEach((button) => {
      const active = button.id === id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.hooks.onToolChanged?.(id);
  }

  /** ツールバーの並び順（1始まり）でツールを切り替える。数字キーのショートカット用。 */
  activateByIndex(index: number): boolean {
    const id = TOOL_BUTTON_IDS[index - 1];
    if (!id) return false;
    this.activate(id);
    return true;
  }

  get activeTool(): ToolButtonId {
    return this.activeToolId;
  }

  cancelCurrentOperation(): void {
    this.cadView.handler?.onDeactivate?.(this.cadView);
    this.cadView.handler = this.createHandler(this.activeToolId);
  }

  historyLabel(): HistoryMessageKey {
    const labels: Partial<Record<ToolButtonId, HistoryMessageKey>> = {
      'btn-move': 'history.moveNode',
      'btn-add-node': 'history.addNode',
      'btn-add-beam': 'history.addBeam',
      'btn-add-pillar': 'history.addPillar',
      'btn-add-floor': 'history.addFloor',
      'btn-add-wall': 'history.addWall',
      'btn-add-bearwall': 'history.addBearWall',
    };
    return labels[this.activeToolId] ?? 'history.cadEdit';
  }

  private createHandler(id: ToolButtonId): ICadMouseHandler {
    const handler = this.factories[id]();
    const { shouldOpenProperties, defaultSection, requestLayerAbove } = this.hooks;
    // 選択ツールのダブルクリック編集は常に開く。作成直後の自動表示だけ設定で抑止できる。
    const isCreationTool = id !== 'btn-select' && id !== 'btn-move';
    handler.setDialogCallback?.((data) => {
      if (isCreationTool && shouldOpenProperties && !shouldOpenProperties()) return;
      this.showDataDialog(data);
    });
    if (defaultSection) handler.setDefaultSectionProvider?.(defaultSection);
    if (requestLayerAbove) handler.setLayerAboveRequest?.(requestLayerAbove);
    return handler;
  }
}
