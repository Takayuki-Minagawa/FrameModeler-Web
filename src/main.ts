import './styles/main.css';
import { AppController, type DraftRestoreChoice } from './controllers/AppController';
import { CoordinateEntryController } from './controllers/CoordinateEntryController';
import { EditController } from './controllers/EditController';
import { ExportController } from './controllers/ExportController';
import { FileController } from './controllers/FileController';
import { FileMenuController } from './controllers/FileMenuController';
import { LayerController } from './controllers/LayerController';
import { PropertyEditController } from './controllers/PropertyEditController';
import { SettingsStore, type AppFlag } from './controllers/SettingsStore';
import { ShortcutController } from './controllers/ShortcutController';
import { TOOL_LABEL_KEYS, ToolController } from './controllers/ToolController';
import { ViewOptionsController } from './controllers/ViewOptionsController';
import { Document } from './data/Document';
import { copyLayerContents } from './data/LayerCopy';
import type { HistoryState } from './history/DocumentHistory';
import { clearDraft } from './history/DraftStore';
import { getLocale, initI18n, setLocale, subscribeLocaleChanged, t, toggleLocale, translateHistoryLabel } from './i18n';
import { CadView } from './ui/CadView';
import { showHelpDialog } from './ui/dialogs/HelpDialog';
import { showChoiceDialog, showMessageDialog } from './ui/dialogs/MessageDialog';
import { showMessageLogDialog } from './ui/dialogs/MessageLogDialog';
import { byId } from './ui/dom';
import { messageLog } from './ui/MessageLog';
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
const startupParams = new URLSearchParams(window.location.search);
const canvas = byId<HTMLCanvasElement>('cad-canvas');
const canvasTitle = canvas.title;

// URL パラメータ ?lang=en&theme=dark は保存済み設定より優先し、検証・デモ・自動テストの初期状態を固定できる。
const langParam = startupParams.get('lang');
if (langParam === 'ja' || langParam === 'en') setLocale(langParam);
const themeParam = startupParams.get('theme');
if (themeParam === 'dark' || themeParam === 'light') settingsStore.setTheme(themeParam === 'dark');

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
const notify = (message: () => string): void => statusBar.showNotice(message);

// ========== ツールと変更履歴 ==========

// PropertyEditController は AppController の後に生成するため、ダイアログ呼出しは遅延参照にする。
const toolController = new ToolController(cadView, (data) => void propertyEditController.edit(data), document, {
  shouldOpenProperties: () => settingsStore.getFlag('openPropertiesOnCreate'),
  defaultSection: (kind) => propertyEditController.defaultSectionFor(kind),
  requestLayerAbove: (currentZ) => layerController.requestLayerAbove(currentZ),
  onToolChanged: (id) => statusBar.setTool(TOOL_LABEL_KEYS[id]),
});
const cancelOperation = (): void => toolController.cancelCurrentOperation();

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

const fileController = new FileController(doc);
const fileMenuController = new FileMenuController({
  document: doc,
  appController,
  fileController,
  cadView,
  fileInput: byId<HTMLInputElement>('file-input'),
  importInfoButton: byId<HTMLButtonElement>('btn-import-info'),
  cancelOperation,
  refreshDocument,
  notify,
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
  settings: {
    confirmDelete: () => settingsStore.getFlag('confirmDelete'),
    removeOrphansOnDelete: () => settingsStore.getFlag('removeOrphansOnDelete'),
  },
});
editController.connect();

new ExportController({ document: doc, cadView, cancelOperation, notify }).connect();

const viewOptionsController = new ViewOptionsController({
  document: doc,
  cadView,
  cancelOperation,
  // 選択・計測は立面でも使える。作図ツールの場合だけ選択ツールへ戻す。
  ensureElevationTool: () => {
    if (!cadView.handler?.supportsElevationPicking) toolController.activate('btn-select');
  },
  fitOnViewChange: () => settingsStore.getFlag('fitOnViewChange'),
});
viewOptionsController.connect();

const coordinateZ = byId<HTMLInputElement>('input-coordinate-z');
new CoordinateEntryController(
  cadView,
  doc,
  {
    x: byId<HTMLInputElement>('input-coordinate-x'),
    y: byId<HTMLInputElement>('input-coordinate-y'),
    z: coordinateZ,
    commit: byId<HTMLButtonElement>('btn-coordinate-commit'),
    distance: byId<HTMLInputElement>('input-distance'),
    angle: byId<HTMLInputElement>('input-angle'),
    polarCommit: byId<HTMLButtonElement>('btn-polar-commit'),
  },
  notify,
).connect();

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
// LayerController の生成後にツールバーを結線し、ツール切替通知が ステータスバーへ届くようにする。
toolController.connectToolbar();

installToolbarMenus();

// ========== 設定メニュー ==========

for (const input of document.querySelectorAll<HTMLInputElement>('[data-app-flag]')) {
  const flag = input.dataset.appFlag as AppFlag;
  input.checked = settingsStore.getFlag(flag);
  input.addEventListener('change', () => settingsStore.setFlag(flag, input.checked));
}

// 狭い画面ではツールバーを折りたたみ、作図領域を優先する。
const toolbar = byId<HTMLElement>('toolbar');
const toolbarToggle = byId<HTMLButtonElement>('btn-toolbar-toggle');
const setToolbarExpanded = (expanded: boolean): void => {
  toolbar.classList.toggle('expanded', expanded);
  toolbarToggle.setAttribute('aria-expanded', String(expanded));
};
setToolbarExpanded(false);
toolbarToggle.addEventListener('click', () => setToolbarExpanded(!toolbar.classList.contains('expanded')));

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

const messageLogButton = byId<HTMLButtonElement>('btn-message-log');
messageLogButton.addEventListener('click', () => void showMessageLogDialog());
messageLog.subscribe((entries) => {
  messageLogButton.dataset.count = String(entries.length);
});

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
    save: () => void fileMenuController.save(),
    open: () => void fileMenuController.requestOpen(),
    undo,
    redo,
    cancel: cancelOperation,
    deleteSelection: () => void editController.deleteSelection(),
    selectAll: () => editController.selectAll(),
    invertSelection: () => editController.invertSelection(),
    arrayCopy: () => void editController.arrayCopy(),
    fit: () => cadView.fitToScene(),
    activateTool: (index) => toolController.activateByIndex(index),
    cycleSnap: (direction) => cadView.cycleSnapCandidate(direction),
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
    await appController.offerDraftRestore(async (savedAt) => {
      const when = new Date(savedAt).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
      // 自動的に閉じられる標準 confirm では復旧の選択肢が消えてしまう。破棄は明示操作だけで行う。
      const choice = await showChoiceDialog<DraftRestoreChoice>(
        t('msg.confirmRestoreDraft', { when }),
        [
          { label: t('draft.later'), value: 'later' },
          { label: t('draft.discard'), value: 'discard', danger: true },
          { label: t('draft.restore'), value: 'restore', primary: true },
        ],
        { title: t('dialog.restoreDraft') },
      );
      return choice ?? 'later';
    });
  } catch (error) {
    await clearDraft();
    await showMessageDialog(t('msg.draftInvalid', { message: (error as Error).message }), { level: 'error' });
  }
}

// 新規作成と同じ状態（既定レイヤー 1F : 0）から始める。履歴・未保存状態には含めない。
appController.withoutHistory(() => fileController.reset());
appController.resetHistory(true);
refreshDocument(false);
// IndexedDBの確認中にユーザー操作が古いdraftで上書きされないよう、初期化完了まで無効化する。
const appRoot = byId<HTMLElement>('app');
appRoot.inert = true;
const fileParam = startupParams.get('file');
const startup = fileParam
  ? // ?file=<URL> で指定されたモデルを開く。draft の提示はこの起動では行わず、次回へ持ち越す。
    fileMenuController.openFromUrl(fileParam)
  : offerDraftRestore();
void startup.finally(() => {
  appRoot.inert = false;
});
