import './styles/main.css';
import { Document } from './data/Document';
import { DocumentData } from './data/DocumentData';
import { Node } from './data/Node';
import { Member } from './data/Member';
import { Plane } from './data/Plane';
import { CadView } from './ui/CadView';
import { Layer } from './ui/Layer';
import { deserializeXml } from './io/XmlDeserializer';
import { downloadXml } from './io/XmlSerializer';
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

// ========== アプリケーション初期化 ==========

const doc = Document.instance;
const canvas = document.getElementById('cad-canvas') as HTMLCanvasElement;
const cadView = new CadView(canvas);

// ========== ダイアログ表示関数 ==========

async function showDataDialog(data: DocumentData): Promise<void> {
  if (data instanceof Node) {
    await showNodeDialog(data);
  } else if (data instanceof Member) {
    await showMemberDialog(data);
  } else if (data instanceof Plane) {
    await showPlaneDialog(data);
  }
  cadView.render();
}

// ========== ハンドラ管理 ==========

function createHandler(id: string): ICadMouseHandler {
  switch (id) {
    case 'btn-select': {
      const h = new SelectionHandler();
      h.setDialogCallback(showDataDialog);
      return h;
    }
    case 'btn-move': {
      const h = new MoveNodeHandler();
      h.setDialogCallback(showDataDialog);
      return h;
    }
    case 'btn-add-node':
      return new AddNodeHandler();
    case 'btn-add-beam': {
      const h = new AddBeamHandler();
      h.showDialog = showDataDialog;
      return h;
    }
    case 'btn-add-pillar': {
      const h = new AddPillarHandler();
      h.showDialog = showDataDialog;
      return h;
    }
    case 'btn-add-floor': {
      const h = new AddFloorHandler();
      h.showDialog = showDataDialog;
      return h;
    }
    case 'btn-add-wall': {
      const h = new AddWallHandler();
      h.showDialog = showDataDialog;
      return h;
    }
    case 'btn-add-bearwall': {
      const h = new AddBearWallHandler();
      h.showDialog = showDataDialog;
      return h;
    }
    default: {
      const h = new SelectionHandler();
      h.setDialogCallback(showDataDialog);
      return h;
    }
  }
}

let activeToolId = 'btn-select';

function setActiveTool(id: string): void {
  activeToolId = id;
  cadView.handler = createHandler(id);

  // ボタンのアクティブ状態を更新
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.id === id);
  });
}

// 初期ハンドラ設定
setActiveTool('btn-select');

// ========== ツールバーボタン接続 ==========

// ツール切替ボタン
const toolBtnIds = [
  'btn-select', 'btn-move', 'btn-add-node', 'btn-add-beam',
  'btn-add-pillar', 'btn-add-floor', 'btn-add-wall', 'btn-add-bearwall',
];
for (const id of toolBtnIds) {
  document.getElementById(id)?.addEventListener('click', () => setActiveTool(id));
}

// 新規ボタン
document.getElementById('btn-new')?.addEventListener('click', () => {
  if (confirm('現在のデータを破棄して新規作成しますか？')) {
    doc.init();
    doc.filename = '';
    updateLayerList();
    cadView.render();
  }
});

// 開くボタン
const fileInput = document.getElementById('file-input') as HTMLInputElement;
document.getElementById('btn-open')?.addEventListener('click', () => {
  fileInput.click();
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      deserializeXml(reader.result as string);
      doc.filename = file.name;
      updateLayerList();
      cadView.fitToScene();
      cadView.render();
      updateStatusInfo();
    } catch (e) {
      alert('ファイル読込エラー: ' + (e as Error).message);
    }
  };
  reader.readAsText(file);

  // 同じファイルを再度選択できるようリセット
  fileInput.value = '';
});

// 保存ボタン
document.getElementById('btn-save')?.addEventListener('click', () => {
  const filename = doc.hasFileName ? doc.filename : 'model.xml';
  downloadXml(filename);
});

// 削除ボタン
document.getElementById('btn-delete')?.addEventListener('click', () => {
  const selected = [...doc.allDataList].filter(d => d.select);
  if (selected.length === 0) return;

  // 逆順で削除（Plane → Member → Node の順）
  const sorted = selected.sort((a, b) => {
    const order = (d: DocumentData) => {
      if (d instanceof Plane) return 0;
      if (d instanceof Member) return 1;
      if (d instanceof Node) return 2;
      return 3;
    };
    return order(a) - order(b);
  });

  for (const data of sorted) {
    try {
      doc.remove(data);
    } catch (e) {
      // 参照されているNodeは削除できない
    }
  }
  cadView.render();
  updateStatusInfo();
});

// ========== チェックボックス ==========

const chkGrid = document.getElementById('chk-grid') as HTMLInputElement;
const chkSnap = document.getElementById('chk-snap') as HTMLInputElement;
const chk3D = document.getElementById('chk-3d') as HTMLInputElement;
const inputGridWidth = document.getElementById('input-grid-width') as HTMLInputElement;
const inputSnapWidth = document.getElementById('input-snap-width') as HTMLInputElement;

chkGrid.addEventListener('change', () => { cadView.showGrid = chkGrid.checked; });
chkSnap.addEventListener('change', () => { cadView.snapping = chkSnap.checked; });
chk3D.addEventListener('change', () => { cadView.show3D = chk3D.checked; });
inputGridWidth.addEventListener('change', () => { cadView.gridWidth = parseInt(inputGridWidth.value) || 100; });
inputSnapWidth.addEventListener('change', () => { cadView.snapWidth = parseInt(inputSnapWidth.value) || 10; });

// ========== レイヤーパネル ==========

const layerList = document.getElementById('layer-list') as HTMLUListElement;

function updateLayerList(): void {
  layerList.innerHTML = '';
  for (const layer of doc.layers) {
    const li = document.createElement('li');
    li.textContent = layer.toString();
    li.classList.toggle('active', layer === doc.shownLayer);
    li.addEventListener('click', () => {
      doc.shownLayer = layer;
      updateLayerList();
      cadView.render();
    });
    layerList.appendChild(li);
  }
}

// レイヤー追加
document.getElementById('btn-add-layer')?.addEventListener('click', async () => {
  const layer = await showLayerDialog();
  if (layer) {
    if (!doc.addLayer(layer)) {
      alert('同一Z位置のレイヤーが既に存在します');
    } else {
      doc.shownLayer = layer;
      updateLayerList();
      cadView.render();
    }
  }
});

// レイヤー削除
document.getElementById('btn-remove-layer')?.addEventListener('click', () => {
  if (doc.shownLayer) {
    doc.removeLayer(doc.shownLayer);
    updateLayerList();
    cadView.render();
  }
});

// レイヤー変更通知
doc.onLayerChanged = () => {
  updateLayerList();
};

// ========== ステータスバー ==========

const statusCoord = document.getElementById('status-coord')!;
const statusInfo = document.getElementById('status-info')!;

cadView.onMouseMove = (pos) => {
  statusCoord.textContent = `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;
};

function updateStatusInfo(): void {
  const nodes = doc.nodeList.length;
  const members = doc.memberList.length;
  const planes = doc.planeList.length;
  statusInfo.textContent = `N:${nodes} M:${members} P:${planes}`;
}

doc.onChanged = () => {
  updateStatusInfo();
};

// ========== 初期描画 ==========

updateLayerList();
updateStatusInfo();
cadView.render();
