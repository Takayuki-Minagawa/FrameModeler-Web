import type { DocumentData } from '../data/DocumentData';
import type { HistoryMessageKey } from '../i18n';
import { SelectionFilter } from '../selection/SelectionFilter';
import type { CadView } from '../ui/CadView';
import { AddBeamHandler } from '../ui/handlers/AddBeamHandler';
import { AddBearWallHandler } from '../ui/handlers/AddBearWallHandler';
import { AddFloorHandler } from '../ui/handlers/AddFloorHandler';
import { AddNodeHandler } from '../ui/handlers/AddNodeHandler';
import { AddPillarHandler } from '../ui/handlers/AddPillarHandler';
import { AddWallHandler } from '../ui/handlers/AddWallHandler';
import type { ICadMouseHandler } from '../ui/handlers/ICadMouseHandler';
import { MoveNodeHandler } from '../ui/handlers/MoveNodeHandler';
import { SelectionHandler } from '../ui/handlers/SelectionHandler';

export const TOOL_BUTTON_IDS = [
  'btn-select',
  'btn-move',
  'btn-add-node',
  'btn-add-beam',
  'btn-add-pillar',
  'btn-add-floor',
  'btn-add-wall',
  'btn-add-bearwall',
] as const;

type ToolButtonId = (typeof TOOL_BUTTON_IDS)[number];

/** 作図ツールの生成、切替、途中操作破棄をmainから分離する。 */
export class ToolController {
  readonly selectionFilter = new SelectionFilter();
  private activeToolId: ToolButtonId = 'btn-select';
  private readonly factories: Record<ToolButtonId, () => ICadMouseHandler>;

  constructor(
    private readonly cadView: CadView,
    private readonly showDataDialog: (data: DocumentData) => void,
    private readonly root: Document = document,
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
    handler.setDialogCallback?.(this.showDataDialog);
    return handler;
  }
}
