export type Locale = 'ja' | 'en';

const STORAGE_KEY = 'framemodeler-locale';

let currentLocale: Locale = (localStorage.getItem(STORAGE_KEY) as Locale) || 'ja';
let onLocaleChanged: (() => void) | null = null;

const messages: Record<string, Record<Locale, string>> = {
  // Toolbar - File
  new: { ja: '新規', en: 'New' },
  open: { ja: '開く', en: 'Open' },
  save: { ja: '保存', en: 'Save' },

  // Toolbar - Tools
  select: { ja: '選択', en: 'Select' },
  move: { ja: '移動', en: 'Move' },
  node: { ja: '節点', en: 'Node' },
  beam: { ja: '梁', en: 'Beam' },
  pillar: { ja: '柱', en: 'Pillar' },
  floor: { ja: '床', en: 'Floor' },
  wall: { ja: '壁', en: 'Wall' },
  bearwall: { ja: '耐力壁', en: 'BearWall' },
  delete: { ja: '削除', en: 'Delete' },

  // Toolbar - Titles
  'title.new': { ja: '新規作成', en: 'New' },
  'title.open': { ja: '開く', en: 'Open' },
  'title.save': { ja: '保存', en: 'Save' },
  'title.select': { ja: '選択', en: 'Select' },
  'title.move': { ja: '移動', en: 'Move' },
  'title.node': { ja: '節点追加', en: 'Add Node' },
  'title.beam': { ja: '梁追加', en: 'Add Beam' },
  'title.pillar': { ja: '柱追加', en: 'Add Pillar' },
  'title.floor': { ja: '床追加', en: 'Add Floor' },
  'title.wall': { ja: '壁追加', en: 'Add Wall' },
  'title.bearwall': { ja: '耐力壁追加', en: 'Add BearWall' },
  'title.delete': { ja: '選択要素を削除', en: 'Delete selected' },
  'title.help': { ja: '操作マニュアル', en: 'Help' },
  'title.theme': { ja: 'テーマ切替', en: 'Toggle theme' },
  'title.lang': { ja: '言語切替', en: 'Switch language' },

  // Checkboxes / Labels
  grid: { ja: 'グリッド', en: 'Grid' },
  snap: { ja: 'スナップ', en: 'Snap' },
  '3d': { ja: '3D表示', en: '3D View' },
  gridWidth: { ja: 'グリッド幅:', en: 'Grid:' },
  snapWidth: { ja: 'スナップ幅:', en: 'Snap:' },

  // Layer panel
  layer: { ja: 'レイヤー', en: 'Layer' },
  'title.addLayer': { ja: 'レイヤー追加', en: 'Add Layer' },
  'title.removeLayer': { ja: 'レイヤー削除', en: 'Remove Layer' },

  // Dialogs
  ok: { ja: 'OK', en: 'OK' },
  cancel: { ja: 'キャンセル', en: 'Cancel' },
  close: { ja: '閉じる', en: 'Close' },
  'dialog.nodeProps': { ja: '節点プロパティ', en: 'Node Properties' },
  'dialog.beamProps': { ja: '梁プロパティ', en: 'Beam Properties' },
  'dialog.pillarProps': { ja: '柱プロパティ', en: 'Pillar Properties' },
  'dialog.floorProps': { ja: '床プロパティ', en: 'Floor Properties' },
  'dialog.wallProps': { ja: '壁プロパティ', en: 'Wall Properties' },
  'dialog.bearwallProps': { ja: '耐力壁プロパティ', en: 'BearWall Properties' },
  'dialog.planeProps': { ja: '面要素プロパティ', en: 'Plane Properties' },
  'dialog.layerAdd': { ja: 'レイヤー追加', en: 'Add Layer' },
  'dialog.layerEdit': { ja: 'レイヤー編集', en: 'Edit Layer' },
  section: { ja: '断面', en: 'Section' },
  weight: { ja: '荷重', en: 'Weight' },
  direction: { ja: '方向', en: 'Direction' },
  name: { ja: '名前', en: 'Name' },
  zPosition: { ja: 'Z位置', en: 'Z Position' },

  // Messages
  'msg.confirmNew': { ja: '現在のデータを破棄して新規作成しますか？', en: 'Discard current data and create new?' },
  'msg.fileError': { ja: 'ファイル読込エラー: ', en: 'File load error: ' },
  'msg.duplicateLayer': { ja: '同一Z位置のレイヤーが既に存在します', en: 'A layer at the same Z position already exists' },
  'msg.defaultLayerName': { ja: '新規レイヤー', en: 'New Layer' },

  // Help dialog
  'help.title': { ja: '操作マニュアル', en: 'Operation Manual' },
  'help.tools': { ja: 'ツール操作', en: 'Tool Operations' },
  'help.camera': { ja: 'カメラ操作', en: 'Camera Controls' },
  'help.data': { ja: 'データ形式', en: 'Data Format' },

  'help.select.name': { ja: '選択', en: 'Select' },
  'help.select.desc': { ja: 'クリック: 要素選択（Shift: 追加, Ctrl: 反転）\nドラッグ: 矩形選択\nダブルクリック: プロパティ表示', en: 'Click: select (Shift: add, Ctrl: toggle)\nDrag: box select\nDouble-click: properties' },
  'help.move.name': { ja: '移動', en: 'Move' },
  'help.move.desc': { ja: '選択した節点をクリックで移動先を指定', en: 'Click to set destination for selected nodes' },
  'help.addNode.name': { ja: '節点追加', en: 'Add Node' },
  'help.addNode.desc': { ja: 'クリック位置に節点を追加', en: 'Click to add a node at that position' },
  'help.addBeam.name': { ja: '梁追加', en: 'Add Beam' },
  'help.addBeam.desc': { ja: '2つの節点をクリックして梁を作成', en: 'Click two nodes to create a beam' },
  'help.addPillar.name': { ja: '柱追加', en: 'Add Pillar' },
  'help.addPillar.desc': { ja: 'クリック位置に柱を追加（現レイヤー→上レイヤー）', en: 'Click to add a pillar (current layer to upper layer)' },
  'help.addFloor.name': { ja: '床追加', en: 'Add Floor' },
  'help.addFloor.desc': { ja: '2点クリックで矩形の床を作成', en: 'Click two points to create a rectangular floor' },
  'help.addWall.name': { ja: '壁追加', en: 'Add Wall' },
  'help.addWall.desc': { ja: '2点クリックで壁を作成', en: 'Click two points to create a wall' },
  'help.addBearWall.name': { ja: '耐力壁追加', en: 'Add BearWall' },
  'help.addBearWall.desc': { ja: '2点クリックで耐力壁を作成', en: 'Click two points to create a bearing wall' },

  'help.camera.rightDrag': { ja: '右ドラッグ', en: 'Right drag' },
  'help.camera.rightDrag.desc': { ja: '2D: パン / 3D: 回転', en: '2D: pan / 3D: rotate' },
  'help.camera.middleDrag': { ja: '中央ドラッグ', en: 'Middle drag' },
  'help.camera.middleDrag.desc': { ja: 'パン', en: 'Pan' },
  'help.camera.wheel': { ja: 'ホイール', en: 'Wheel' },
  'help.camera.wheel.desc': { ja: 'ズーム', en: 'Zoom' },

  'help.data.desc': { ja: 'JSON形式でモデルデータを保存・読込します。\n座標系: X=右, Y=奥, Z=上（mm単位）', en: 'Save/load model data in JSON format.\nCoordinates: X=right, Y=depth, Z=up (mm unit)' },
};

export function t(key: string): string {
  const entry = messages[key];
  if (!entry) return key;
  return entry[currentLocale] ?? entry['ja'] ?? key;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  updateDom();
  if (onLocaleChanged) onLocaleChanged();
}

export function toggleLocale(): void {
  setLocale(currentLocale === 'ja' ? 'en' : 'ja');
}

export function setOnLocaleChanged(callback: () => void): void {
  onLocaleChanged = callback;
}

/** data-i18n 属性を持つ全要素のテキストを更新 */
export function updateDom(): void {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!;
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')!;
    (el as HTMLElement).title = t(key);
  });
  // Update labels with format "text: input"
  document.querySelectorAll('[data-i18n-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-label')!;
    const label = el as HTMLLabelElement;
    const input = label.querySelector('input, select');
    if (input) {
      label.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = t(key) + ' ';
        }
      });
    }
  });
  // Update checkbox labels
  document.querySelectorAll('[data-i18n-after]').forEach((el) => {
    const key = el.getAttribute('data-i18n-after')!;
    const label = el as HTMLLabelElement;
    // Find the text node after the input
    const input = label.querySelector('input');
    if (input && input.nextSibling) {
      input.nextSibling.textContent = ' ' + t(key);
    }
  });
}

/** 初期化: DOMロード後に呼ぶ */
export function initI18n(): void {
  updateDom();
}
