import type { Document } from '../data/Document';
import { summarizeModel } from '../data/ModelSummary';
import { kindLabel, t } from '../i18n';
import { CSV_BOM, elementsToCsv, nodesToCsv, summaryToCsv } from '../io/CsvExporter';
import { downloadBlob, downloadText, exportFilename } from '../io/download';
import { exportDxf } from '../io/DxfExporter';
import type { CadView } from '../ui/CadView';
import { showModelSummaryDialog } from '../ui/dialogs/ModelSummaryDialog';

export interface ExportControllerOptions {
  document: Document;
  cadView: CadView;
  cancelOperation: () => void;
  notify: (message: () => string) => void;
  root?: globalThis.Document;
}

const CSV_MIME = 'text/csv;charset=utf-8';

/** 数量集計と、PNG / DXF / CSV への出力をまとめる。モデルは変更しない。 */
export class ExportController {
  private readonly root: globalThis.Document;

  constructor(private readonly options: ExportControllerOptions) {
    this.root = options.root ?? document;
  }

  connect(): void {
    const bind = (id: string, action: () => unknown): void => {
      this.root.getElementById(id)?.addEventListener('click', () => void this.run(action));
    };
    bind('btn-summary', () => this.showSummary());
    bind('btn-export-png', () => this.exportPng());
    bind('btn-export-dxf', () => this.exportDxf());
    bind('btn-export-nodes-csv', () => this.exportNodesCsv());
    bind('btn-export-elements-csv', () => this.exportElementsCsv());
  }

  async showSummary(): Promise<void> {
    const summary = summarizeModel(this.options.document);
    await showModelSummaryDialog(summary, () => {
      const csv = summaryToCsv(summary, {
        kind: t('summary.kind'),
        section: t('section'),
        count: t('summary.count'),
        lengthM: t('summary.totalLength'),
        areaM2: t('summary.totalArea'),
        total: t('summary.total'),
        unassigned: t('summary.unassigned'),
        kindName: kindLabel,
      });
      this.saveText(this.filename('_summary', 'csv'), CSV_BOM + csv, CSV_MIME);
    });
  }

  async exportPng(): Promise<void> {
    const blob = await this.options.cadView.captureImage();
    const name = this.filename('', 'png');
    downloadBlob(name, blob);
    this.options.notify(() => t('msg.exported', { name }));
  }

  /** 平面表示では現在の階の伏図、3D・立面表示ではモデル全体を出力する。 */
  exportDxf(): void {
    const { document: doc, cadView } = this.options;
    const layer = cadView.viewMode === 'plan' ? doc.shownLayer : null;
    const dxf = exportDxf(doc, {
      layer,
      include: (data) => doc.isDataVisible(data) && cadView.displayFilter.allows(data),
    });
    const suffix = layer ? `_${layer.name.replace(/[\\/:*?"<>|\s]+/g, '_')}` : '';
    this.saveText(this.filename(suffix, 'dxf'), dxf, 'application/dxf');
  }

  exportNodesCsv(): void {
    this.saveText(this.filename('_nodes', 'csv'), CSV_BOM + nodesToCsv(this.options.document), CSV_MIME);
  }

  exportElementsCsv(): void {
    this.saveText(this.filename('_elements', 'csv'), CSV_BOM + elementsToCsv(this.options.document), CSV_MIME);
  }

  private async run(action: () => unknown): Promise<void> {
    // 移動previewなどDocument未確定の一時状態を出力へ含めない。
    this.options.cancelOperation();
    try {
      await action();
    } catch (error) {
      alert(t('msg.exportFailed', { message: (error as Error).message }));
    }
  }

  private saveText(name: string, content: string, mimeType: string): void {
    downloadText(name, content, mimeType);
    this.options.notify(() => t('msg.exported', { name }));
  }

  private filename(suffix: string, extension: string): string {
    return exportFilename(this.options.document.filename, suffix, extension);
  }
}
