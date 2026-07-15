import './styles/main.css';
import { Document } from './data/Document';
import { DocumentData } from './data/DocumentData';
import { Node } from './data/Node';
import { inspectModel, type ModelIssue } from './data/ModelInspector';
import { Point3D } from './math/Point3D';
import type { SelectionKind } from './selection/SelectionFilter';
import { Member } from './data/Member';
import { Plane } from './data/Plane';
import { CadView, type CadOperationStatus } from './ui/CadView';
import type { DocumentSnapshot, HistoryState } from './history/DocumentHistory';
import { clearDraft } from './history/DraftStore';
import { showNodeDialog } from './ui/dialogs/NodeDialog';
import { showMemberDialog } from './ui/dialogs/MemberDialog';
import { showPlaneDialog } from './ui/dialogs/PlaneDialog';
import { showSupportDialog } from './ui/dialogs/SupportDialog';
import { showConstraintDialog } from './ui/dialogs/ConstraintDialog';
import { showModelValidationDialog } from './ui/dialogs/ModelValidationDialog';
import { showHelpDialog } from './ui/dialogs/HelpDialog';
import { showImportInfoDialog } from './ui/dialogs/ImportInfoDialog';
import { showCalcYamlImportModeDialog } from './ui/dialogs/CalcYamlImportModeDialog';
import {
  t,
  initI18n,
  toggleLocale,
  getLocale,
  subscribeLocaleChanged,
  translateHistoryLabel,
  type MessageKey,
} from './i18n';
import { APP_VERSION } from './version';
import { getObjectSnapCandidateKind, getObjectSnapKindInfo, type ObjectSnapCandidateKind } from './ui/ObjectSnapEngine';
import { Floor } from './data/Floor';
import { Wall } from './data/Wall';
import { DeleteSelectionCommand, UpdatePropertiesCommand } from './commands/DocumentCommands';
import { ToolController } from './controllers/ToolController';
import { SettingsStore } from './controllers/SettingsStore';
import { LayerController } from './controllers/LayerController';
import { copyLayerContents } from './data/LayerCopy';
import { pointFromDistanceAndAngle } from './math/PlanInput';
import type { DisplayLabelOption } from './display/DisplayLabels';
import { FileController } from './controllers/FileController';
import { AppController, sameSnapshot } from './controllers/AppController';
import { Support } from './data/Support';
import { Constraint } from './data/Constraint';
import { cloneNodeMass } from './data/StructuralDof';
import { Truss } from './data/Truss';
import { Spring } from './data/Spring';

// ========== テーマ管理 ==========
const settingsStore = new SettingsStore();

// ========== DOM ヘルパ ==========

/** 必須要素を型付きで取得する。存在しなければ即座にエラー（V-12） */
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element not found: #${id}`);
  return el as T;
}

// ========== アプリケーション初期化 ==========

const doc = Document.instance;
const fileController = new FileController(doc);
const canvas = byId<HTMLCanvasElement>('cad-canvas');

// テーマは CadView 生成より先に適用する（保存済みダークテーマの初期背景色を
// CadView コンストラクタの setClearColor に反映させるため）
settingsStore.initializeTheme();

const cadView = new CadView(canvas);

// i18n 初期化
initI18n();
updateLangButton();

// ========== ダイアログ表示関数 ==========

async function showDataDialog(data: DocumentData): Promise<void> {
  try {
    await performTrackedChange('history.propertyEdit', async () => {
      if (data instanceof Node) {
        const changes = await showNodeDialog(data);
        if (changes) {
          doc.execute(
            new UpdatePropertiesCommand('節点プロパティ編集', data, (node) => {
              node.pos = changes.pos.clone();
              node.mass = cloneNodeMass(changes.mass);
            }),
          );
        }
      } else if (data instanceof Member) {
        const changes = await showMemberDialog(data);
        if (changes) {
          doc.execute(
            new UpdatePropertiesCommand('部材プロパティ編集', data, (member) => {
              member.section = changes.section;
              if (member instanceof Truss && changes.kind === 'truss') {
                member.material = changes.material;
                member.area = changes.area;
                member.areaUnit = changes.areaUnit;
                member.elasticModulus = changes.elasticModulus;
                member.stressUnit = changes.stressUnit;
              } else if (member instanceof Spring && changes.kind === 'spring') {
                member.components = changes.components.map((component) => ({ ...component }));
                member.orientX = changes.orientX?.clone() ?? null;
                member.orientY = changes.orientY?.clone() ?? null;
                member.shearDistance = changes.shearDistance ? [...changes.shearDistance] : null;
                member.note = changes.note;
              }
            }),
          );
        }
      } else if (data instanceof Plane) {
        const changes = await showPlaneDialog(data);
        if (changes) {
          doc.execute(
            new UpdatePropertiesCommand('面プロパティ編集', data, (plane) => {
              plane.section = changes.section;
              if (plane instanceof Floor) {
                if (changes.weight !== undefined) plane.weight = changes.weight;
                if (changes.direction !== undefined) plane.direction = changes.direction;
              } else if (plane instanceof Wall && changes.weight !== undefined) {
                plane.weight = changes.weight;
              }
            }),
          );
        }
      } else if (data instanceof Support) {
        const changes = await showSupportDialog(data);
        if (changes) {
          doc.execute(
            new UpdatePropertiesCommand('支点プロパティ編集', data, (support) => {
              support.fixedDofs = [...changes.fixedDofs];
            }),
          );
        }
      } else if (data instanceof Constraint) {
        const changes = await showConstraintDialog(data);
        if (changes) {
          doc.execute(
            new UpdatePropertiesCommand('拘束プロパティ編集', data, (constraint) => {
              constraint.slaveDof = changes.slaveDof;
              constraint.terms = changes.terms.map((term) => ({ ...term }));
            }),
          );
        }
      }
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

const toolController = new ToolController(cadView, (data) => void showDataDialog(data));
const selectionFilter = toolController.selectionFilter;
const cancelActiveOperation = (): void => toolController.cancelCurrentOperation();
toolController.connectToolbar();

// ========== 変更履歴 / draft復旧 ==========

const appController = new AppController({
  document: doc,
  cancelOperation: cancelActiveOperation,
  refreshDocument: refreshDocumentUi,
});
const history = appController.history;
const performTrackedChange = appController.performTrackedChange;
const restoreDocumentSnapshot = (snapshot: DocumentSnapshot): void => appController.restoreSnapshot(snapshot);

/** Document.add 等の同期通知を同一microtask内で1履歴へまとめる。 */
function scheduleHistoryRecord(label: string = toolController.historyLabel()): void {
  appController.scheduleHistoryRecord(label);
}

function refreshDocumentUi(fit: boolean): void {
  cadView.setOperationStatus(null);
  layerController.render();
  cadView.renderSelection();
  updateStatusInfo();
  updateImportInfoButton();
  if (fit) cadView.fitToScene();
  cadView.render();
}

// ========== ツールバーボタン接続 ==========

// 新規ボタン
document.getElementById('btn-new')?.addEventListener('click', () => {
  cancelActiveOperation();
  if (history.isDirty && !confirm(t('msg.confirmNew'))) return;

  appController.withoutHistory(() => fileController.reset());
  appController.resetHistory(true);
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
    try {
      const content = reader.result as string;
      const opened = await appController.withoutHistoryAsync(() =>
        fileController.openText(file.name, content, showCalcYamlImportModeDialog),
      );
      if (!opened) return;
      appController.resetHistory(true);
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
    }
  };
  reader.onerror = () => {
    alert(t('msg.fileError') + (reader.error?.message ?? 'File read failed'));
  };
  reader.readAsText(file);

  // 同じファイルを再度選択できるようリセット
  fileInput.value = '';
});

// 保存ボタン
document.getElementById('btn-save')?.addEventListener('click', () => {
  // 移動previewなどDocument未確定の一時状態は保存しない。
  cancelActiveOperation();
  const issues = inspectModel(doc);
  if (issues.some((issue) => issue.severity === 'error')) {
    void showModelValidationDialog(issues, selectValidationTargets);
    return;
  }
  fileController.save();
  appController.markSaved();
});

document.getElementById('btn-validate')?.addEventListener('click', () => {
  cancelActiveOperation();
  void showModelValidationDialog(inspectModel(doc), selectValidationTargets);
});

function selectValidationTargets(issue: ModelIssue): void {
  const targets = new Set(issue.targets);
  for (const data of doc.allDataList) data.select = targets.has(data);
  cadView.renderSelection();
  cadView.fitToData(issue.targets);
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

function localized(ja: string, en: string): string {
  return getLocale() === 'ja' ? ja : en;
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
            !selectedSet.has(data) &&
            (data instanceof Member ||
              data instanceof Plane ||
              data instanceof Support ||
              data instanceof Constraint) &&
            data.isReferring(node),
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

  void performTrackedChange('history.deleteSelection', () => doc.execute(new DeleteSelectionCommand(selected)))
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
  settingsStore.toggleTheme();
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
subscribeLocaleChanged(() => {
  layerController.render();
  updateStatusInfo();
  refreshHistoryControls(history.state);
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
const inputDistance = byId<HTMLInputElement>('input-distance');
const inputAngle = byId<HTMLInputElement>('input-angle');
const polarCommitButton = byId<HTMLButtonElement>('btn-polar-commit');
const snapConstraintSelect = byId<HTMLSelectElement>('select-snap-constraint');
const snapCycleButton = byId<HTMLButtonElement>('btn-cycle-snap');

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

function commitDistanceAndAngle(): void {
  const anchor = cadView.constraintAnchor;
  if (!anchor) {
    alert(localized('先に1点目を指定してください。', 'Specify the first point before distance/angle input.'));
    return;
  }
  try {
    const result = pointFromDistanceAndAngle({
      anchor,
      distance: inputDistance.valueAsNumber,
      angleDegrees: inputAngle.valueAsNumber,
      workPlaneZ: doc.shownLayer?.posZ ?? anchor.z,
    });
    inputCoordinateX.value = String(result.position.x);
    inputCoordinateY.value = String(result.position.y);
    inputCoordinateZ.value = String(result.position.z);
    inputAngle.value = String(result.angleDegrees);
    cadView.handler?.onClick(cadView, result.position, new MouseEvent('click'));
  } catch (error) {
    inputDistance.setCustomValidity((error as Error).message);
    inputDistance.reportValidity();
  }
}

polarCommitButton.addEventListener('click', commitDistanceAndAngle);
for (const input of [inputDistance, inputAngle]) {
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDistanceAndAngle();
    }
  });
}

snapConstraintSelect.addEventListener('change', () => {
  cadView.snapConstraintMode = snapConstraintSelect.value as 'all' | 'axis' | 'orthogonal' | 'none';
});
snapCycleButton.addEventListener('click', () => cadView.cycleSnapCandidate());

const selectionKindInputs = [...document.querySelectorAll<HTMLInputElement>('[data-selection-kind]')];
for (const input of selectionKindInputs) input.addEventListener('change', updateSelectionFilter);

function updateSelectionFilter(): void {
  const enabled = selectionKindInputs
    .filter((input) => input.checked)
    .map((input) => input.dataset.selectionKind as SelectionKind);
  if (enabled.length === selectionKindInputs.length) selectionFilter.reset();
  else selectionFilter.enableOnly(...enabled);
  for (const data of doc.allDataList) {
    if (data.select && !selectionFilter.allows(data)) data.select = false;
  }
  cadView.renderSelection();
}

for (const input of document.querySelectorAll<HTMLInputElement>('[data-label-option]')) {
  input.addEventListener('change', () => {
    cadView.setLabelEnabled(input.dataset.labelOption as DisplayLabelOption, input.checked);
  });
}

byId<HTMLButtonElement>('btn-display-selected').addEventListener('click', () => {
  cadView.displayFilter.showSelectedOnly(true);
  cadView.renderElements();
});
byId<HTMLButtonElement>('btn-hide-selected').addEventListener('click', () => {
  cadView.displayFilter.hideSelected(doc.allDataList);
  cadView.renderElements();
});
byId<HTMLButtonElement>('btn-isolate-selected').addEventListener('click', () => {
  cadView.displayFilter.isolateSelected(doc.allDataList);
  cadView.renderElements();
});
byId<HTMLButtonElement>('btn-show-all').addEventListener('click', () => {
  cadView.displayFilter.showAll();
  cadView.renderElements();
});

function setStandardView(view: 'top' | 'front' | 'right' | 'isometric'): void {
  cancelActiveOperation();
  if (view === 'front' || view === 'right') toolController.activate('btn-select');
  cadView.setStandardView(view);
  chk3D.checked = cadView.show3D;
}

byId<HTMLButtonElement>('btn-view-top').addEventListener('click', () => setStandardView('top'));
byId<HTMLButtonElement>('btn-view-front').addEventListener('click', () => setStandardView('front'));
byId<HTMLButtonElement>('btn-view-right').addEventListener('click', () => setStandardView('right'));
byId<HTMLButtonElement>('btn-view-isometric').addEventListener('click', () => setStandardView('isometric'));

// ========== レイヤーパネル ==========

const layerList = byId<HTMLUListElement>('layer-list');
const layerController = new LayerController({
  document: doc,
  cadView,
  list: layerList,
  coordinateZ: inputCoordinateZ,
  trackChange: performTrackedChange,
  cancelOperation: cancelActiveOperation,
  copyContents: (source, target) => copyLayerContents(source, target, doc),
});
layerController.connect();

// ========== ステータスバー ==========

const statusVersion = byId('status-version');
const statusCoord = byId('status-coord');
const statusInfo = byId('status-info');
let workPlaneStatus = '';
let snapKind: ObjectSnapCandidateKind = 'none';
let operationStatus: CadOperationStatus | null = null;
let selectedCount = 0;

const operationStatusMessageKeys: Record<CadOperationStatus, MessageKey> = {
  firstPointSelected: 'operation.firstPointSelected',
  noPointAbove: 'operation.noPointAbove',
  coincidentPoints: 'operation.coincidentPoints',
  duplicateElement: 'operation.duplicateElement',
};

statusVersion.textContent = `Ver.${APP_VERSION}`;

cadView.onMouseMove = (pos) => {
  statusCoord.textContent = `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
};

function updateStatusInfo(): void {
  const nodes = doc.nodeList.length;
  const members = doc.memberList.length;
  const planes = doc.planeList.length;
  const snapStatus = snapKind === 'none' ? '' : `${t('snap')}: ${t(getObjectSnapKindInfo(snapKind).labelKey)}`;
  const operationText = operationStatus ? t(operationStatusMessageKeys[operationStatus]) : '';
  const details = [operationText, workPlaneStatus, snapStatus].filter(Boolean).join(' / ');
  statusInfo.textContent = `N:${nodes} M:${members} P:${planes} S:${selectedCount}${details ? ` — ${details}` : ''}`;
}

cadView.onSelectionChanged = (selected) => {
  selectedCount = selected.length;
  updateStatusInfo();
};

cadView.onOperationStatusChanged = (status) => {
  operationStatus = status;
  updateStatusInfo();
};

cadView.onWorkPlaneUnavailable = (message) => {
  workPlaneStatus = message ?? '';
  updateStatusInfo();
};

cadView.onSnapChanged = (result) => {
  snapKind = getObjectSnapCandidateKind(result);
  updateStatusInfo();
};

doc.subscribe(() => {
  cadView.displayFilter.prune(doc.allDataList);
  updateStatusInfo();
  updateImportInfoButton();
  scheduleHistoryRecord();
});

const undoButton = document.getElementById('btn-undo') as HTMLButtonElement | null;
const redoButton = document.getElementById('btn-redo') as HTMLButtonElement | null;

undoButton?.addEventListener('click', () => {
  cancelActiveOperation();
  appController.undo();
});

redoButton?.addEventListener('click', () => {
  cancelActiveOperation();
  appController.redo();
});

function refreshHistoryControls(state: HistoryState): void {
  document.title = `FrameModeler Web v${APP_VERSION}${state.isDirty ? ' *' : ''}`;
  statusVersion.textContent = `Ver.${APP_VERSION}${state.isDirty ? ' *' : ''}`;
  if (undoButton) {
    undoButton.disabled = !state.canUndo;
    undoButton.title = state.undoLabel ? `${t('undo')}: ${translateHistoryLabel(state.undoLabel)}` : t('undo');
  }
  if (redoButton) {
    redoButton.disabled = !state.canRedo;
    redoButton.title = state.redoLabel ? `${t('redo')}: ${translateHistoryLabel(state.redoLabel)}` : t('redo');
  }
}

appController.subscribeHistory(refreshHistoryControls);

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
  } else if (!editingText && e.key === 'Tab' && document.activeElement === canvas) {
    e.preventDefault();
    cadView.cycleSnapCandidate(e.shiftKey ? -1 : 1);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (!history.isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

async function offerDraftRestore(): Promise<void> {
  try {
    await appController.offerDraftRestore((savedAt) => {
      const when = new Date(savedAt).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
      return confirm(localized(`${when} の未保存データを復旧しますか？`, `Restore unsaved data from ${when}?`));
    });
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

layerController.render();
cadView.renderSelection();
updateStatusInfo();
updateImportInfoButton();
cadView.render();
// IndexedDBの確認中にユーザー操作が古いdraftで上書きされないよう、初期化完了まで無効化する。
const appRoot = byId<HTMLElement>('app');
appRoot.inert = true;
void offerDraftRestore().finally(() => {
  appRoot.inert = false;
});
