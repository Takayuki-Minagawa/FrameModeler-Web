import './styles/main.css';
import { AppController } from './controllers/AppController';
import { CoordinateEntryController } from './controllers/CoordinateEntryController';
import { EditController } from './controllers/EditController';
import { ExportController } from './controllers/ExportController';
import { FileController } from './controllers/FileController';
import { FileMenuController } from './controllers/FileMenuController';
import { LayerController } from './controllers/LayerController';
import { PropertyEditController } from './controllers/PropertyEditController';
import { SettingsStore } from './controllers/SettingsStore';
import { ShortcutController } from './controllers/ShortcutController';
import { ToolController } from './controllers/ToolController';
import { ViewOptionsController } from './controllers/ViewOptionsController';
import { Document } from './data/Document';
import { copyLayerContents } from './data/LayerCopy';
import type { HistoryState } from './history/DocumentHistory';
import { clearDraft } from './history/DraftStore';
import { getLocale, initI18n, subscribeLocaleChanged, t, toggleLocale, translateHistoryLabel } from './i18n';
import { CadView } from './ui/CadView';
import { showHelpDialog } from './ui/dialogs/HelpDialog';
import { byId } from './ui/dom';
import { getObjectSnapCandidateKind } from './ui/ObjectSnapEngine';
import { StatusBar } from './ui/StatusBar';
import { installToolbarMenus } from './ui/toolbarMenus';
import { APP_VERSION } from './version';

/**
 * アプリケーションの composition root。
 * 各Controllerを生成して相互に結線するだけで、操作ロジックは持たない。
 */

// ========== 基盤 ==========

const doc = Document.instance;
const settingsStore = new SettingsStore();
const canvas = byId<HTMLCanvasElement>('cad-canvas');
const canvasTitle = canvas.title;

// テーマは CadView 生成より先に適用する（保存済みダークテーマの初期背景色を
// CadView コンストラクタの setClearColor に反映させるため）
settingsStore.initializeTheme();
const cadView = new CadView(canvas);
initI18n();

const statusBar = new StatusBar(
  { version: byId('status-version'), coordinate: byId('status-coord'), info: byId('status-info') },
  doc,
  APP_VERSION,
);
const notify = (message: string): void => statusBar.showNotice(message);

// ========== ツールと変更履歴 ==========

// PropertyEditController は AppController の後に生成するため、ダイアログ呼出しは遅延参照にする。
const toolController = new ToolController(cadView, (data) => void propertyEditController.edit(data));
const cancelOperation = (): void => toolController.cancelCurrentOperation();
toolController.connectToolbar();

const appController = new AppController({
  document: doc,
  cancelOperation,
  refreshDocument,
});
const trackChange = appController.performTrackedChange;

const propertyEditController = new PropertyEditController({
  document: doc,
  trackChange,
  onFinished: () => cadView.render(),
});

/** モデルを置き換える・戻す操作の後に、関連するUIをまとめて同期する。 */
function refreshDocument(fit: boolean): void {
  cadView.setOperationStatus(null);
  layerController.render();
  cadView.renderSelection();
  statusBar.refresh();
  fileMenuController.updateImportInfoButton();
  if (fit) cadView.fitToScene();
  cadView.render();
}

// ========== 各機能のController ==========

const fileMenuController = new FileMenuController({
  document: doc,
  appController,
  fileController: new FileController(doc),
  cadView,
  fileInput: byId<HTMLInputElement>('file-input'),
  importInfoButton: byId<HTMLButtonElement>('btn-import-info'),
  cancelOperation,
  refreshDocument,
});
fileMenuController.connect();

const editController = new EditController({
  document: doc,
  cadView,
  selectionFilter: toolController.selectionFilter,
  trackChange,
  cancelOperation,
  refreshDocument,
  notify,
});
editController.connect();

new ExportController({ document: doc, cadView, cancelOperation, notify }).connect();

const viewOptionsController = new ViewOptionsController({
  document: doc,
  cadView,
  cancelOperation,
  activateSelectTool: () => toolController.activate('btn-select'),
});
viewOptionsController.connect();

const coordinateZ = byId<HTMLInputElement>('input-coordinate-z');
new CoordinateEntryController(cadView, doc, {
  x: byId<HTMLInputElement>('input-coordinate-x'),
  y: byId<HTMLInputElement>('input-coordinate-y'),
  z: coordinateZ,
  commit: byId<HTMLButtonElement>('btn-coordinate-commit'),
  distance: byId<HTMLInputElement>('input-distance'),
  angle: byId<HTMLInputElement>('input-angle'),
  polarCommit: byId<HTMLButtonElement>('btn-polar-commit'),
}).connect();

const layerController = new LayerController({
  document: doc,
  cadView,
  list: byId<HTMLUListElement>('layer-list'),
  coordinateZ,
  trackChange,
  cancelOperation,
  copyContents: (source, target) => copyLayerContents(source, target, doc),
});
layerController.connect();

installToolbarMenus();

// ========== ヘルプ・テーマ・言語 ==========

const langButton = byId<HTMLButtonElement>('btn-lang');
const updateLangButton = (): void => {
  langButton.textContent = getLocale() === 'ja' ? 'EN' : 'JA';
};
updateLangButton();

byId('btn-help').addEventListener('click', () => showHelpDialog());
byId('btn-theme').addEventListener('click', () => {
  settingsStore.toggleTheme();
  cadView.refreshTheme();
});
langButton.addEventListener('click', () => toggleLocale());

// ========== CadView / Document → ステータスバー・履歴 ==========

cadView.onMouseMove = (position) => statusBar.setCoordinate(position);
cadView.onSelectionChanged = (selected) => statusBar.setSelectedCount(selected.length);
cadView.onOperationStatusChanged = (status) => statusBar.setOperationStatus(status);
cadView.onMeasurementChanged = (measurement) => statusBar.setMeasurement(measurement);
cadView.onSnapChanged = (result) => statusBar.setSnapKind(getObjectSnapCandidateKind(result));
cadView.onWorkPlaneUnavailable = (error) => {
  statusBar.setWorkPlaneError(error);
  canvas.title = statusBar.workPlaneMessage || canvasTitle;
};

doc.subscribe(() => {
  cadView.displayFilter.prune(doc.allDataList);
  statusBar.refresh();
  fileMenuController.updateImportInfoButton();
  // Document.add 等の同期通知を同一microtask内で1履歴へまとめる。
  appController.scheduleHistoryRecord(toolController.historyLabel());
});

const undoButton = byId<HTMLButtonElement>('btn-undo');
const redoButton = byId<HTMLButtonElement>('btn-redo');
const undo = (): void => {
  cancelOperation();
  appController.undo();
};
const redo = (): void => {
  cancelOperation();
  appController.redo();
};
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);

function refreshHistoryControls(state: HistoryState): void {
  document.title = `FrameModeler Web v${APP_VERSION}${state.isDirty ? ' *' : ''}`;
  statusBar.setDirty(state.isDirty);
  undoButton.disabled = !state.canUndo;
  undoButton.title = state.undoLabel ? `${t('undo')}: ${translateHistoryLabel(state.undoLabel)}` : t('title.undo');
  redoButton.disabled = !state.canRedo;
  redoButton.title = state.redoLabel ? `${t('redo')}: ${translateHistoryLabel(state.redoLabel)}` : t('title.redo');
}
appController.subscribeHistory(refreshHistoryControls);

subscribeLocaleChanged(() => {
  updateLangButton();
  statusBar.refresh();
  canvas.title = statusBar.workPlaneMessage || canvasTitle;
  refreshHistoryControls(appController.history.state);
});

// ========== キーボード ==========

new ShortcutController({
  canvas,
  actions: {
    save: () => fileMenuController.save(),
    open: () => fileMenuController.requestOpen(),
    undo,
    redo,
    cancel: cancelOperation,
    deleteSelection: () => void editController.deleteSelection(),
    selectAll: () => editController.selectAll(),
    invertSelection: () => editController.invertSelection(),
    arrayCopy: () => void editController.arrayCopy(),
    fit: () => cadView.fitToScene(),
    activateTool: (index) => toolController.activateByIndex(index),
    cycleSnap: (direction) => void cadView.cycleSnapCandidate(direction),
  },
}).connect();

window.addEventListener('beforeunload', (event) => {
  if (!appController.isDirty) return;
  event.preventDefault();
  event.returnValue = '';
});

// ========== 初期描画と draft 復旧 ==========

async function offerDraftRestore(): Promise<void> {
  try {
    await appController.offerDraftRestore((savedAt) => {
      const when = new Date(savedAt).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
      return confirm(t('msg.confirmRestoreDraft', { when }));
    });
  } catch (error) {
    await clearDraft();
    alert(t('msg.draftInvalid', { message: (error as Error).message }));
  }
}

refreshDocument(false);
// IndexedDBの確認中にユーザー操作が古いdraftで上書きされないよう、初期化完了まで無効化する。
const appRoot = byId<HTMLElement>('app');
appRoot.inert = true;
void offerDraftRestore().finally(() => {
  appRoot.inert = false;
});
