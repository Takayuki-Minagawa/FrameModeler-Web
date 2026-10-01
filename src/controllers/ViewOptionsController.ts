import type { Document } from '../data/Document';
import type { DisplayLabelOption } from '../display/DisplayLabels';
import type { CadView } from '../ui/CadView';
import { byId } from '../ui/dom';

export type StandardView = 'top' | 'front' | 'right' | 'isometric';

export interface ViewOptionsControllerOptions {
  document: Document;
  cadView: CadView;
  cancelOperation: () => void;
  /** 立面表示では作図できないため、正面・側面へ切り替える前に立面で使えるツールへ切り替える。 */
  ensureElevationTool: () => void;
  root?: globalThis.Document;
}

/** グリッド・スナップ・2D/3D・標準ビュー・ラベル・表示フィルタのUIを CadView へ結線する。 */
export class ViewOptionsController {
  private readonly root: globalThis.Document;
  private readonly chk3D: HTMLInputElement;

  constructor(private readonly options: ViewOptionsControllerOptions) {
    this.root = options.root ?? document;
    this.chk3D = byId<HTMLInputElement>('chk-3d', this.root);
  }

  connect(): void {
    const { cadView, document: doc, cancelOperation } = this.options;
    const chkGrid = byId<HTMLInputElement>('chk-grid', this.root);
    const chkSnap = byId<HTMLInputElement>('chk-snap', this.root);
    const gridWidth = byId<HTMLInputElement>('input-grid-width', this.root);
    const snapWidth = byId<HTMLInputElement>('input-snap-width', this.root);
    const constraintMode = byId<HTMLSelectElement>('select-snap-constraint', this.root);

    chkGrid.addEventListener('change', () => {
      cadView.showGrid = chkGrid.checked;
    });
    chkSnap.addEventListener('change', () => {
      cadView.snapping = chkSnap.checked;
    });
    this.chk3D.addEventListener('change', () => {
      cancelOperation();
      cadView.show3D = this.chk3D.checked;
    });
    gridWidth.addEventListener('change', () => {
      const value = parsePositiveNumber(gridWidth.value, 100, 5);
      gridWidth.value = String(value);
      cadView.gridWidth = value;
    });
    snapWidth.addEventListener('change', () => {
      const value = parsePositiveNumber(snapWidth.value, 10, 1);
      snapWidth.value = String(value);
      cadView.snapWidth = value;
    });
    constraintMode.addEventListener('change', () => {
      cadView.snapConstraintMode = constraintMode.value as CadView['snapConstraintMode'];
    });
    byId('btn-cycle-snap', this.root).addEventListener('click', () => cadView.cycleSnapCandidate());

    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-label-option]')) {
      input.addEventListener('change', () => {
        cadView.setLabelEnabled(input.dataset.labelOption as DisplayLabelOption, input.checked);
      });
    }

    const bindDisplay = (id: string, apply: () => void): void => {
      byId(id, this.root).addEventListener('click', () => {
        apply();
        cadView.renderElements();
      });
    };
    bindDisplay('btn-display-selected', () => cadView.displayFilter.showSelectedOnly(true));
    bindDisplay('btn-hide-selected', () => cadView.displayFilter.hideSelected(doc.allDataList));
    bindDisplay('btn-isolate-selected', () => cadView.displayFilter.isolateSelected(doc.allDataList));
    bindDisplay('btn-show-all', () => cadView.displayFilter.showAll());

    const views: Array<[string, StandardView]> = [
      ['btn-view-top', 'top'],
      ['btn-view-front', 'front'],
      ['btn-view-right', 'right'],
      ['btn-view-isometric', 'isometric'],
    ];
    for (const [id, view] of views) byId(id, this.root).addEventListener('click', () => this.setStandardView(view));
  }

  setStandardView(view: StandardView): void {
    this.options.cancelOperation();
    if (view === 'front' || view === 'right') this.options.ensureElevationTool();
    this.options.cadView.setStandardView(view);
    this.chk3D.checked = this.options.cadView.show3D;
  }
}

function parsePositiveNumber(raw: string, fallback: number, minimum: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}
