import './styles/main.css';
import { Document } from './data/Document';
import { DocumentData } from './data/DocumentData';
import { Node } from './data/Node';
import { inspectModel, type ModelIssue } from './data/ModelInspector';
import { Point3D } from './math/Point3D';
import { SelectionFilter, type SelectionKind } from './selection/SelectionFilter';
import { Member } from './data/Member';
import { Plane } from './data/Plane';
import { CadView } from './ui/CadView';
import { deserializeCalcYaml } from './io/CalcYamlDeserializer';
import { deserializeJson } from './io/JsonDeserializer';
import { downloadJson } from './io/JsonSerializer';
import { exportDocumentSnapshot, importDocumentSnapshot } from './io/DocumentSnapshotCodec';
import { DocumentHistory, type DocumentSnapshot } from './history/DocumentHistory';
import { clearDraft, loadDraft, saveDraft } from './history/DraftStore';
import type { ICadMouseHandler } from './ui/handlers/ICadMouseHandler';
import { SelectionHandler } from './ui/handlers/SelectionHandler';
import { MoveNodeHandler } from './ui/handlers/MoveNodeHandler';
import { AddNodeHandler } from './ui/handlers/AddNodeHandler';
import { AddBeamHandler } from './ui/handlers/AddBeamHandler';
import { AddPillarHandler } from './ui/handlers/AddPillarHandler';
import { AddFloorHandler } from './ui/handlers/AddFloorHandler';
import { AddWallHandler } from './ui/handlers/AddWallHandler';
import { AddBearWallHandler } from './ui/handlers/AddBearWallHandler';
import { showNodeDialog } from './ui/dialogs/NodeDialog';
import { showMemberDialog } from './ui/dialogs/MemberDialog';
import { showPlaneDialog } from './ui/dialogs/PlaneDialog';
import { showLayerDialog } from './ui/dialogs/LayerDialog';
import { showModelValidationDialog } from './ui/dialogs/ModelValidationDialog';
import { showHelpDialog } from './ui/dialogs/HelpDialog';
import { showImportInfoDialog } from './ui/dialogs/ImportInfoDialog';
import { showCalcYamlImportModeDialog } from './ui/dialogs/CalcYamlImportModeDialog';
import { t, initI18n, toggleLocale, getLocale, setOnLocaleChanged } from './i18n';
import { APP_VERSION } from './version';
import type { ObjectSnapKind } from './ui/ObjectSnapEngine';

// ========== テーマ管理 ==========

const THEME_KEY = 'framemodeler-theme';

function initTheme(): void {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  }
  updateThemeButton();
}

function toggleTheme(): void {
  const isDark = document.documentElement.dataset.theme === 'dark';
  if (isDark) {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(THEME_KEY);
  } else {
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem(THEME_KEY, 'dark');
  }
  updateThemeButton();
}

function updateThemeButton(): void {
  const btn = document.getElementById('btn-theme');
  if (btn) {
    const isDark = document.documentElement.dataset.theme === 'dark';
    btn.textContent = isDark ? '\u2600' : '\u263E';
  }
}

// ========== DOM ヘルパ ==========

/** 必須要素を型付きで取得する。存在しなければ即座にエラー（V-12） */
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element not found: #${id}`);
  return el as T;
}

// ========== アプリケーション初期化 ==========

const doc = Document.instance;
const canvas = byId<HTMLCanvasElement>('cad-canvas');

// テーマは CadView 生成より先に適用する（保存済みダークテーマの初期背景色を
// CadView コンストラクタの setClearColor に反映させるため）
initTheme();

const cadView = new CadView(canvas);

// i18n 初期化
initI18n();
updateLangButton();

// ========== ダイアログ表示関数 ==========

async function showDataDialog(data: DocumentData): Promise<void> {
  try {
    await performTrackedChange('プロパティ編集', async () => {
      let changed = false;
      if (data instanceof Node) {
        changed = await showNodeDialog(data);
      } else if (data instanceof Member) {
        changed = await showMemberDialog(data);
      } else if (data instanceof Plane) {
        changed = await showPlaneDialog(data);
      }
      // 各ダイアログは対象へ値を反映するため、確定時にDocument境界を通して
      // validate・再ソート・再採番・変更通知を一度だけ実行する。
      if (changed) doc.update(() => undefined);
    });
  } catch (error) {
    alert(
      localized(
        `変更を適用できませんでした: ${(error as Error).message}`,
        `The change could not be applied: ${(error as Error).message}`,
      ),
    );
  }
  cadView.render();
}

// ========== ハンドラ管理 ==========

/** ツールIDごとのハンドラ生成関数 */
const selectionFilter = new SelectionFilter();
const handlerFactories: Record<string, () => ICadMouseHandler> = {
  'btn-select': () => new SelectionHandler(selectionFilter),
  'btn-move': () => new MoveNodeHandler(selectionFilter),
  'btn-add-node': () => new AddNodeHandler(),
  'btn-add-beam': () => new AddBeamHandler(),
  'btn-add-pillar': () => new AddPillarHandler(),
  'btn-add-floor': () => new AddFloorHandler(),
  'btn-add-wall': () => new AddWallHandler(),
  'btn-add-bearwall': () => new AddBearWallHandler(),
};

function createHandler(id: string): ICadMouseHandler {
  const factory = handlerFactories[id] ?? handlerFactories['btn-select'];
  const handler = factory();
  // ダイアログ表示コールバックは統一APIで注入（対応ハンドラのみ）
  handler.setDialogCallback?.(showDataDialog);
  return handler;
}

let activeToolId = 'btn-select';

function setActiveTool(id: string): void {
  // 現ハンドラに切替を通知（途中状態のキャンセル等）
  cadView.handler?.onDeactivate?.(cadView);

  activeToolId = id;
  cadView.handler = createHandler(id);

  // ボタンのアクティブ状態を更新
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    const active = btn.id === id;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

/** 現在の途中操作を破棄し、同じツールを初期状態で作り直す。 */
function cancelActiveOperation(): void {
  cadView.handler?.onDeactivate?.(cadView);
  cadView.handler = createHandler(activeToolId);
}

// 初期ハンドラ設定
setActiveTool('btn-select');

// ========== 変更履歴 / draft復旧 ==========

let suppressHistory = false;
let historyFlushScheduled = false;
let pendingHistoryLabel = 'CAD編集';
let draftTimer: number | null = null;

const history = new DocumentHistory(() => exportDocumentSnapshot(doc), restoreDocumentSnapshot);
let historyBaseline = history.capture();

function restoreDocumentSnapshot(snapshot: DocumentSnapshot): void {
  suppressHistory = true;
  try {
    cancelActiveOperation();
    importDocumentSnapshot(snapshot, doc);
  } finally {
    suppressHistory = false;
  }
  historyBaseline = history.capture();
  refreshDocumentUi(false);
}

async function performTrackedChange<T>(label: string, action: () => T | Promise<T>): Promise<T> {
  const before = history.capture();
  suppressHistory = true;
  try {
    const result = await action();
    history.record(label, before);
    return result;
  } catch (error) {
    restoreDocumentSnapshot(before);
    throw error;
  } finally {
    suppressHistory = false;
    historyBaseline = history.capture();
    scheduleDraftUpdate();
  }
}

/** Document.add 等の同期通知を同一microtask内で1履歴へまとめる。 */
function scheduleHistoryRecord(label: string = historyLabelForActiveTool()): void {
  if (suppressHistory) {
    historyBaseline = history.capture();
    return;
  }
  pendingHistoryLabel = label;
  if (historyFlushScheduled) return;
  historyFlushScheduled = true;
  queueMicrotask(() => {
    historyFlushScheduled = false;
    history.record(pendingHistoryLabel, historyBaseline);
    historyBaseline = history.capture();
    scheduleDraftUpdate();
  });
}

function historyLabelForActiveTool(): string {
  const labels: Record<string, string> = {
    'btn-move': '節点移動',
    'btn-add-node': '節点追加',
    'btn-add-beam': '梁追加',
    'btn-add-pillar': '柱追加',
    'btn-add-floor': '床追加',
    'btn-add-wall': '壁追加',
    'btn-add-bearwall': '耐力壁追加',
  };
  return labels[activeToolId] ?? 'CAD編集';
}

function refreshDocumentUi(fit: boolean): void {
  updateLayerList();
  updateStatusInfo();
  updateImportInfoButton();
  if (fit) cadView.fitToScene();
  cadView.render();
}

function scheduleDraftUpdate(): void {
  if (draftTimer !== null) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    draftTimer = null;
    if (history.isDirty) {
      void saveDraft(history.capture());
    } else {
      void clearDraft();
    }
  }, 750);
}

// ========== ツールバーボタン接続 ==========

// ツール切替ボタン
const toolBtnIds = [
  'btn-select',
  'btn-move',
  'btn-add-node',
  'btn-add-beam',
  'btn-add-pillar',
  'btn-add-floor',
  'btn-add-wall',
  'btn-add-bearwall',
];
for (const id of toolBtnIds) {
  document.getElementById(id)?.addEventListener('click', () => setActiveTool(id));
}

// 新規ボタン
document.getElementById('btn-new')?.addEventListener('click', () => {
  cancelActiveOperation();
  if (history.isDirty && !confirm(t('msg.confirmNew'))) return;

  suppressHistory = true;
  try {
    doc.init();
    doc.filename = '';
  } finally {
    suppressHistory = false;
  }
  history.reset(true);
  historyBaseline = history.capture();
  void clearDraft();
  refreshDocumentUi(false);
});

// 開くボタン
const fileInput = document.getElementById('file-input') as HTMLInputElement;
document.getElementById('btn-open')?.addEventListener('click', () => {
  cancelActiveOperation();
  if (
    history.isDirty &&
    !confirm(
      localized('未保存の変更を破棄してファイルを開きますか？', 'Discard unsaved changes and open another file?'),
    )
  )
    return;
  fileInput.click();
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const beforeOpen = history.capture();

  const reader = new FileReader();
  reader.onload = async () => {
    suppressHistory = true;
    try {
      const content = reader.result as string;
      if (isYamlFile(file.name, content)) {
        const mode = await showCalcYamlImportModeDialog();
        if (!mode) return;
        await deserializeCalcYaml(content, { mode });
      } else if (isJsonFile(file.name, content)) {
        deserializeJson(content);
      } else {
        throw new Error(t('msg.unsupportedFileType'));
      }
      doc.filename = file.name;
      history.reset(true);
      historyBaseline = history.capture();
      void clearDraft();
      refreshDocumentUi(true);
      if (doc.importMetadata) {
        await showImportInfoDialog(doc.importMetadata);
      }
    } catch (e) {
      // JSON/YAML parserはcommit前検証を行う。モデルが実際に変わった場合だけ戻し、
      // 単純なparse失敗では選択状態とオブジェクト同一性を保持する。
      try {
        const current = history.capture();
        if (!sameSnapshot(current, beforeOpen)) restoreDocumentSnapshot(beforeOpen);
      } catch {
        restoreDocumentSnapshot(beforeOpen);
      }
      alert(t('msg.fileError') + (e as Error).message);
    } finally {
      suppressHistory = false;
    }
  };
  reader.onerror = () => {
    alert(t('msg.fileError') + (reader.error?.message ?? 'File read failed'));
  };
  reader.readAsText(file);

  // 同じファイルを再度選択できるようリセット
  fileInput.value = '';
});

function isJsonFile(name: string, content: string): boolean {
  return /\.json$/i.test(name) || /^[\s\r\n]*[{\[]/.test(content);
}

function isYamlFile(name: string, content: string): boolean {
  return /\.ya?ml$/i.test(name) || /^[\s\r\n]*schema_version\s*:/i.test(content);
}

// 保存ボタン
document.getElementById('btn-save')?.addEventListener('click', () => {
  // 移動previewなどDocument未確定の一時状態は保存しない。
  cancelActiveOperation();
  const issues = inspectModel(doc);
  if (issues.some((issue) => issue.severity === 'error')) {
    void showModelValidationDialog(issues, selectValidationTargets);
    return;
  }
  const filename = doc.hasFileName ? toJsonFilename(doc.filename) : 'model.json';
  downloadJson(filename);
  doc.filename = filename;
  history.markSaved();
  historyBaseline = history.capture();
  void clearDraft();
});

document.getElementById('btn-validate')?.addEventListener('click', () => {
  cancelActiveOperation();
  void showModelValidationDialog(inspectModel(doc), selectValidationTargets);
});

function selectValidationTargets(issue: ModelIssue): void {
  const targets = new Set(issue.targets);
  for (const data of doc.allDataList) data.select = targets.has(data);
  cadView.renderSelection();
}

const importInfoButton = byId<HTMLButtonElement>('btn-import-info');
importInfoButton.addEventListener('click', () => {
  if (doc.importMetadata) {
    showImportInfoDialog(doc.importMetadata);
  }
});

function updateImportInfoButton(): void {
  importInfoButton.disabled = !doc.importMetadata;
}

/** 任意の拡張子を .json に置き換える（拡張子なしならそのまま付与） */
function toJsonFilename(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dot = name.lastIndexOf('.');
  const base = dot > slash ? name.slice(0, dot) : name;
  return `${base || 'model'}.json`;
}

function localized(ja: string, en: string): string {
  return getLocale() === 'ja' ? ja : en;
}

function sameSnapshot(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
  return (
    a.json === b.json && a.filename === b.filename && JSON.stringify(a.shownLayer) === JSON.stringify(b.shownLayer)
  );
}

function parsePositiveNumber(raw: string, fallback: number, minimum: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

// 削除ボタン
document.getElementById('btn-delete')?.addEventListener('click', () => {
  cancelActiveOperation();
  const selected = [...doc.allDataList].filter((d) => d.select);
  if (selected.length === 0) return;

  const selectedSet = new Set(selected);
  const dependencyFailures = selected
    .filter((data): data is Node => data instanceof Node)
    .flatMap((node) =>
      doc.allDataList
        .filter(
          (data) =>
            !selectedSet.has(data) && (data instanceof Member || data instanceof Plane) && data.isReferring(node),
        )
        .map((data) =>
          localized(
            `節点 ${node.number} は ${data.typeText} ${data.number} から参照されています`,
            `Node ${node.number} is referenced by ${data.typeText} ${data.number}`,
          ),
        ),
    );
  if (dependencyFailures.length > 0) {
    alert(localized('削除できません:\n', 'Delete failed:\n') + dependencyFailures.join('\n'));
    return;
  }

  if (
    !confirm(
      localized(`選択した${selected.length}要素を削除しますか？`, `Delete ${selected.length} selected element(s)?`),
    )
  )
    return;

  void performTrackedChange('選択要素削除', () => doc.removeMany(selected))
    .then(() => refreshDocumentUi(false))
    .catch((error) => {
      alert(localized('削除できませんでした:\n', 'Delete failed:\n') + (error as Error).message);
    });
});

// ヘルプボタン
document.getElementById('btn-help')?.addEventListener('click', () => {
  showHelpDialog();
});

// テーマ切替ボタン
document.getElementById('btn-theme')?.addEventListener('click', () => {
  toggleTheme();
  cadView.refreshTheme();
});

// 言語切替ボタン
document.getElementById('btn-lang')?.addEventListener('click', () => {
  toggleLocale();
  updateLangButton();
});

function updateLangButton(): void {
  const btn = document.getElementById('btn-lang');
  if (btn) {
    btn.textContent = getLocale() === 'ja' ? 'EN' : 'JA';
  }
}

// 言語変更時のコールバック
setOnLocaleChanged(() => {
  updateLayerList();
  updateStatusInfo();
});

// ========== チェックボックス ==========

const chkGrid = byId<HTMLInputElement>('chk-grid');
const chkSnap = byId<HTMLInputElement>('chk-snap');
const chk3D = byId<HTMLInputElement>('chk-3d');
const inputGridWidth = byId<HTMLInputElement>('input-grid-width');
const inputSnapWidth = byId<HTMLInputElement>('input-snap-width');
const inputCoordinateX = byId<HTMLInputElement>('input-coordinate-x');
const inputCoordinateY = byId<HTMLInputElement>('input-coordinate-y');
const inputCoordinateZ = byId<HTMLInputElement>('input-coordinate-z');
const coordinateCommitButton = byId<HTMLButtonElement>('btn-coordinate-commit');
const selectionFilterSelect = byId<HTMLSelectElement>('select-selection-filter');

chkGrid.addEventListener('change', () => {
  cadView.showGrid = chkGrid.checked;
});
chkSnap.addEventListener('change', () => {
  cadView.snapping = chkSnap.checked;
});
chk3D.addEventListener('change', () => {
  cancelActiveOperation();
  cadView.show3D = chk3D.checked;
});
inputGridWidth.addEventListener('change', () => {
  const value = parsePositiveNumber(inputGridWidth.value, 100, 5);
  inputGridWidth.value = String(value);
  cadView.gridWidth = value;
});
inputSnapWidth.addEventListener('change', () => {
  const value = parsePositiveNumber(inputSnapWidth.value, 10, 1);
  inputSnapWidth.value = String(value);
  cadView.snapWidth = value;
});

function commitEnteredCoordinate(): void {
  const inputs = [inputCoordinateX, inputCoordinateY, inputCoordinateZ];
  const values = inputs.map((input) => input.valueAsNumber);
  const invalidIndex = values.findIndex((value) => !Number.isFinite(value));
  if (invalidIndex >= 0) {
    const input = inputs[invalidIndex];
    input.setCustomValidity(t('validation.finiteNumber'));
    input.reportValidity();
    input.focus();
    return;
  }
  inputs.forEach((input) => input.setCustomValidity(''));
  cadView.handler?.onClick(cadView, new Point3D(values[0], values[1], values[2]), new MouseEvent('click'));
}

coordinateCommitButton.addEventListener('click', commitEnteredCoordinate);
for (const input of [inputCoordinateX, inputCoordinateY, inputCoordinateZ]) {
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEnteredCoordinate();
    }
  });
}

selectionFilterSelect.addEventListener('change', () => {
  const value = selectionFilterSelect.value;
  if (value === 'all') selectionFilter.reset();
  else selectionFilter.enableOnly(value as SelectionKind);
  for (const data of doc.allDataList) {
    if (data.select && !selectionFilter.allows(data)) data.select = false;
  }
  cadView.renderSelection();
});

// ========== レイヤーパネル ==========

const layerList = byId<HTMLUListElement>('layer-list');

// クリックは要素委譲で1つのリスナにまとめる（V-14）
layerList.addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest('li');
  if (!li?.dataset.index) return;
  selectLayerByIndex(parseInt(li.dataset.index));
});

layerList.addEventListener('dblclick', (e) => {
  const li = (e.target as HTMLElement).closest('li');
  if (!li?.dataset.index) return;
  void editLayerByIndex(parseInt(li.dataset.index));
});

layerList.addEventListener('keydown', (e) => {
  const li = (e.target as HTMLElement).closest('li');
  if (!li?.dataset.index) return;
  const current = parseInt(li.dataset.index);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = Math.max(0, Math.min(doc.layers.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)));
    selectLayerByIndex(next);
    layerList.querySelector<HTMLElement>(`li[data-index="${next}"]`)?.focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectLayerByIndex(current);
  }
});

function selectLayerByIndex(index: number): void {
  const layer = doc.layers[index];
  if (!layer) return;
  cancelActiveOperation();
  doc.shownLayer = layer;
  inputCoordinateZ.value = String(layer.posZ);
  updateLayerSelectionState();
  cadView.render();
}

function updateLayerSelectionState(): void {
  for (const item of layerList.querySelectorAll<HTMLLIElement>('li[data-index]')) {
    const index = Number(item.dataset.index);
    const active = doc.layers[index] === doc.shownLayer;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active || (!doc.shownLayer && index === 0) ? 0 : -1;
  }
}

async function editLayerByIndex(index: number): Promise<void> {
  const layer = doc.layers[index];
  if (!layer) return;
  cancelActiveOperation();
  const edited = await showLayerDialog(layer);
  if (!edited) return;
  try {
    await performTrackedChange('レイヤー編集', () => {
      doc.updateLayer(layer, { name: edited.name, posZ: edited.posZ });
      doc.shownLayer = layer;
    });
    updateLayerList();
    cadView.render();
  } catch (error) {
    alert(
      localized(
        `レイヤーを変更できませんでした: ${(error as Error).message}`,
        `The layer could not be updated: ${(error as Error).message}`,
      ),
    );
  }
}

function updateLayerList(): void {
  layerList.innerHTML = '';
  if (doc.shownLayer) inputCoordinateZ.value = String(doc.shownLayer.posZ);
  doc.layers.forEach((layer, i) => {
    const li = document.createElement('li');
    li.textContent = layer.toString();
    li.dataset.index = String(i);
    const active = layer === doc.shownLayer;
    li.classList.toggle('active', active);
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(active));
    li.tabIndex = active || (!doc.shownLayer && i === 0) ? 0 : -1;
    layerList.appendChild(li);
  });
}

// レイヤー追加
document.getElementById('btn-add-layer')?.addEventListener('click', async () => {
  cancelActiveOperation();
  const layer = await showLayerDialog();
  if (layer) {
    await performTrackedChange('レイヤー追加', () => {
      if (!doc.addLayer(layer)) {
        alert(t('msg.duplicateLayer'));
      } else {
        doc.shownLayer = layer;
      }
    });
    updateLayerList();
    cadView.render();
  }
});

// レイヤー削除
document.getElementById('btn-remove-layer')?.addEventListener('click', () => {
  cancelActiveOperation();
  const layer = doc.shownLayer;
  if (!layer) return;
  const count = doc.allDataList.filter((data) => data.existsOn(layer)).length;
  if (
    !confirm(
      localized(
        `レイヤー「${layer.name}」を削除しますか？（関連要素: ${count}）`,
        `Delete layer "${layer.name}"? (${count} related elements)`,
      ),
    )
  )
    return;

  void performTrackedChange('レイヤー削除', () => doc.removeLayer(layer)).then(() => {
    updateLayerList();
    cadView.render();
  });
});

// レイヤー変更通知
doc.onLayerChanged = () => {
  const items = [...layerList.querySelectorAll<HTMLLIElement>('li[data-index]')];
  const structureChanged =
    items.length !== doc.layers.length ||
    items.some((item, index) => item.textContent !== doc.layers[index]?.toString());
  if (structureChanged) updateLayerList();
  else updateLayerSelectionState();
};

// ========== ステータスバー ==========

const statusVersion = byId('status-version');
const statusCoord = byId('status-coord');
const statusInfo = byId('status-info');
let workPlaneStatus = '';
let snapKind: ObjectSnapKind = 'none';

statusVersion.textContent = `Ver.${APP_VERSION}`;

cadView.onMouseMove = (pos) => {
  statusCoord.textContent = `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
};

function updateStatusInfo(): void {
  const nodes = doc.nodeList.length;
  const members = doc.memberList.length;
  const planes = doc.planeList.length;
  const snapLabels: Record<Exclude<ObjectSnapKind, 'none'>, string> = getLocale() === 'ja'
    ? { node: '節点', endpoint: '端点', midpoint: '中点', intersection: '交点', grid: 'グリッド' }
    : { node: 'Node', endpoint: 'Endpoint', midpoint: 'Midpoint', intersection: 'Intersection', grid: 'Grid' };
  const snapStatus = snapKind === 'none' ? '' : `Snap: ${snapLabels[snapKind]}`;
  const details = [workPlaneStatus, snapStatus].filter(Boolean).join(' / ');
  statusInfo.textContent = `N:${nodes} M:${members} P:${planes}${details ? ` — ${details}` : ''}`;
}

cadView.onWorkPlaneUnavailable = (message) => {
  workPlaneStatus = message ?? '';
  updateStatusInfo();
};

cadView.onSnapChanged = (result) => {
  snapKind = result.kind;
  updateStatusInfo();
};

doc.onChanged = () => {
  updateStatusInfo();
  updateImportInfoButton();
  scheduleHistoryRecord();
};

const undoButton = document.getElementById('btn-undo') as HTMLButtonElement | null;
const redoButton = document.getElementById('btn-redo') as HTMLButtonElement | null;

undoButton?.addEventListener('click', () => {
  cancelActiveOperation();
  if (history.undo()) {
    historyBaseline = history.capture();
    scheduleDraftUpdate();
  }
});

redoButton?.addEventListener('click', () => {
  cancelActiveOperation();
  if (history.redo()) {
    historyBaseline = history.capture();
    scheduleDraftUpdate();
  }
});

history.subscribe((state) => {
  document.title = `FrameModeler Web v${APP_VERSION}${state.isDirty ? ' *' : ''}`;
  statusVersion.textContent = `Ver.${APP_VERSION}${state.isDirty ? ' *' : ''}`;
  if (undoButton) {
    undoButton.disabled = !state.canUndo;
    undoButton.title = state.undoLabel ? `Undo: ${state.undoLabel}` : 'Undo';
  }
  if (redoButton) {
    redoButton.disabled = !state.canRedo;
    redoButton.title = state.redoLabel ? `Redo: ${state.redoLabel}` : 'Redo';
  }
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-overlay')) return;
  const target = e.target as HTMLElement | null;
  const editingText = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
  const command = e.ctrlKey || e.metaKey;

  if (!editingText && command && e.key.toLowerCase() === 's') {
    e.preventDefault();
    document.getElementById('btn-save')?.click();
  } else if (!editingText && command && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    document.getElementById('btn-open')?.click();
  } else if (!editingText && command && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoButton?.click();
    else undoButton?.click();
  } else if (!editingText && command && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redoButton?.click();
  } else if (!editingText && e.key === 'Escape') {
    cancelActiveOperation();
  } else if (!editingText && e.key === 'Delete') {
    e.preventDefault();
    document.getElementById('btn-delete')?.click();
  } else if (!editingText && (e.key === 'Home' || e.key.toLowerCase() === 'f')) {
    e.preventDefault();
    cadView.fitToScene();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (!history.isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

async function offerDraftRestore(): Promise<void> {
  try {
    const draft = await loadDraft();
    if (!draft) return;
    const when = new Date(draft.savedAt).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
    if (confirm(localized(`${when} の未保存データを復旧しますか？`, `Restore unsaved data from ${when}?`))) {
      restoreDocumentSnapshot(draft);
      history.reset(false);
      historyBaseline = history.capture();
      refreshDocumentUi(true);
      await clearDraft(draft.draftKey);
      scheduleDraftUpdate();
    } else {
      await clearDraft(draft.draftKey);
    }
  } catch (error) {
    await clearDraft();
    alert(
      localized(
        `復旧データを読み込めなかったため破棄しました: ${(error as Error).message}`,
        `The recovery draft was invalid and has been discarded: ${(error as Error).message}`,
      ),
    );
  }
}

// ========== 初期描画 ==========

updateLayerList();
updateStatusInfo();
updateImportInfoButton();
cadView.render();
// IndexedDBの確認中にユーザー操作が古いdraftで上書きされないよう、初期化完了まで無効化する。
const appRoot = byId<HTMLElement>('app');
appRoot.inert = true;
void offerDraftRestore().finally(() => {
  appRoot.inert = false;
});
