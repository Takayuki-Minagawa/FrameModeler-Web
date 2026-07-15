export type Locale = 'ja' | 'en';

const STORAGE_KEY = 'framemodeler-locale';

const savedLocale = localStorage.getItem(STORAGE_KEY);
let currentLocale: Locale = savedLocale === 'en' ? 'en' : 'ja';
let legacyLocaleChanged: (() => void) | null = null;
const localeChangeListeners = new Set<(locale: Locale) => void>();

const messages = {
  // Toolbar - File
  new: { ja: '新規', en: 'New' },
  open: { ja: '開く', en: 'Open' },
  save: { ja: '保存', en: 'Save' },
  validate: { ja: '検証', en: 'Validate' },
  importInfo: { ja: '読込情報', en: 'Import Info' },

  // Toolbar - Tools
  select: { ja: '選択', en: 'Select' },
  move: { ja: '移動', en: 'Move' },
  node: { ja: '節点', en: 'Node' },
  beam: { ja: '梁', en: 'Beam' },
  pillar: { ja: '柱', en: 'Pillar' },
  floor: { ja: '床', en: 'Floor' },
  wall: { ja: '壁', en: 'Wall' },
  bearwall: { ja: '耐力壁', en: 'BearWall' },
  truss: { ja: 'トラス', en: 'Truss' },
  spring: { ja: 'ばね', en: 'Spring' },
  support: { ja: '支点', en: 'Support' },
  constraint: { ja: '拘束', en: 'Constraint' },
  undo: { ja: '元に戻す', en: 'Undo' },
  redo: { ja: 'やり直す', en: 'Redo' },
  delete: { ja: '削除', en: 'Delete' },
  'coordinate.commit': { ja: '入力', en: 'Apply' },
  'coordinate.polarCommit': { ja: '距離・角度', en: 'Distance/Angle' },

  // Toolbar - Titles
  'title.new': { ja: '新規作成', en: 'New' },
  'title.open': { ja: '開く', en: 'Open' },
  'title.save': { ja: '保存', en: 'Save' },
  'title.validate': { ja: '保存前モデル検証', en: 'Validate model before saving' },
  'title.importInfo': { ja: 'YAML読込情報', en: 'YAML import info' },
  'title.select': { ja: '選択', en: 'Select' },
  'title.move': { ja: '移動', en: 'Move' },
  'title.node': { ja: '節点追加', en: 'Add Node' },
  'title.beam': { ja: '梁追加', en: 'Add Beam' },
  'title.pillar': { ja: '柱追加', en: 'Add Pillar' },
  'title.floor': { ja: '床追加', en: 'Add Floor' },
  'title.wall': { ja: '壁追加', en: 'Add Wall' },
  'title.bearwall': { ja: '耐力壁追加', en: 'Add BearWall' },
  'title.undo': { ja: '元に戻す (Ctrl/Cmd+Z)', en: 'Undo (Ctrl/Cmd+Z)' },
  'title.redo': { ja: 'やり直す (Ctrl+Y / Cmd+Shift+Z)', en: 'Redo (Ctrl+Y / Cmd+Shift+Z)' },
  'title.delete': { ja: '選択要素を削除', en: 'Delete selected' },
  'title.coordinateCommit': { ja: '現在のツールへ座標を入力', en: 'Send coordinates to the active tool' },
  'title.help': { ja: '操作マニュアル', en: 'Help' },
  'title.theme': { ja: 'テーマ切替', en: 'Toggle theme' },
  'title.lang': { ja: '言語切替', en: 'Switch language' },

  // Checkboxes / Labels
  grid: { ja: 'グリッド', en: 'Grid' },
  snap: { ja: 'スナップ', en: 'Snap' },
  '3d': { ja: '3D表示', en: '3D View' },
  gridWidth: { ja: 'グリッド幅:', en: 'Grid:' },
  snapWidth: { ja: 'スナップ幅:', en: 'Snap:' },
  'selection.filter': { ja: '選択対象:', en: 'Select:' },
  'selection.all': { ja: 'すべて', en: 'All' },
  'view.top': { ja: '上面', en: 'Top' },
  'view.front': { ja: '正面', en: 'Front' },
  'view.right': { ja: '側面', en: 'Right' },
  'view.isometric': { ja: 'アイソメ', en: 'Isometric' },
  'snap.constraint': { ja: '拘束:', en: 'Constraint:' },
  'snap.constraint.all': { ja: '軸・直交', en: 'Axis + orthogonal' },
  'snap.constraint.axis': { ja: 'X/Y軸', en: 'X/Y axes' },
  'snap.constraint.orthogonal': { ja: '直交', en: 'Orthogonal' },
  'snap.constraint.none': { ja: 'なし', en: 'None' },
  'snap.cycle': { ja: '候補切替', en: 'Cycle snap' },
  'snap.none': { ja: 'なし', en: 'None' },
  'snap.node': { ja: '節点', en: 'Node' },
  'snap.endpoint': { ja: '端点', en: 'Endpoint' },
  'snap.midpoint': { ja: '中点', en: 'Midpoint' },
  'snap.intersection': { ja: '交点', en: 'Intersection' },
  'snap.grid': { ja: 'グリッド', en: 'Grid' },
  'snap.horizontal': { ja: '画面水平', en: 'Horizontal' },
  'snap.vertical': { ja: '画面鉛直', en: 'Vertical' },
  'snap.axisX': { ja: 'X軸', en: 'X axis' },
  'snap.axisY': { ja: 'Y軸', en: 'Y axis' },
  'snap.orthogonal': { ja: '直交', en: 'Orthogonal' },
  'coordinate.distance': { ja: '距離', en: 'Distance' },
  'coordinate.angle': { ja: '角度', en: 'Angle' },
  'display.labels': { ja: 'ラベル', en: 'Labels' },
  'display.nodeNumber': { ja: '節点番号', en: 'Node number' },
  'display.memberNumber': { ja: '部材番号', en: 'Member number' },
  'display.planeNumber': { ja: '面番号', en: 'Plane number' },
  'display.floorDirection': { ja: '床方向', en: 'Floor direction' },
  'display.weight': { ja: '荷重', en: 'Weight' },
  'display.storyHeight': { ja: '階高', en: 'Story height' },
  'display.localAxes': { ja: 'ローカル軸', en: 'Local axes' },
  'display.selectedOnly': { ja: '選択のみ', en: 'Selected only' },
  'display.hideSelected': { ja: '選択非表示', en: 'Hide selected' },
  'display.isolateSelected': { ja: '選択隔離', en: 'Isolate selected' },
  'display.showAll': { ja: '全表示', en: 'Show all' },

  // CAD operation status
  'operation.firstPointSelected': { ja: '1点目選択済み', en: 'First point selected' },
  'operation.noPointAbove': {
    ja: '直上の節点または部材が見つかりません',
    en: 'No node or member was found directly above',
  },
  'operation.coincidentPoints': { ja: '異なる2点を指定してください', en: 'Specify two different points' },
  'operation.duplicateElement': { ja: '同じ位置の要素が既に存在します', en: 'An element already exists here' },

  // Layer panel
  layer: { ja: 'レイヤー', en: 'Layer' },
  'title.addLayer': { ja: 'レイヤー追加', en: 'Add Layer' },
  'title.removeLayer': { ja: 'レイヤー削除', en: 'Remove Layer' },

  // Accessible names
  'aria.toolbar': { ja: '作図ツールバー', en: 'Drawing toolbar' },
  'aria.fileActions': { ja: 'ファイル操作', en: 'File actions' },
  'aria.drawingTools': { ja: '作図ツール', en: 'Drawing tools' },
  'aria.viewOptions': { ja: '表示設定', en: 'View options' },
  'aria.gridSettings': { ja: 'グリッドとスナップの設定', en: 'Grid and snap settings' },
  'aria.coordinateEntry': { ja: '座標数値入力', en: 'Numeric coordinate entry' },
  'aria.editActions': { ja: '編集操作', en: 'Edit actions' },
  'aria.displayActions': { ja: '表示要素', en: 'Element display' },
  'aria.appSettings': { ja: 'ヘルプと表示設定', en: 'Help and display settings' },
  'aria.layers': { ja: 'レイヤー一覧', en: 'Layer list' },
  'aria.cadCanvas': { ja: '構造フレーム作図領域', en: 'Structural frame drawing area' },
  'coordinate.x': { ja: 'X座標', en: 'X coordinate' },
  'coordinate.y': { ja: 'Y座標', en: 'Y coordinate' },
  'coordinate.z': { ja: 'Z座標', en: 'Z coordinate' },

  // Dialogs
  ok: { ja: 'OK', en: 'OK' },
  cancel: { ja: 'キャンセル', en: 'Cancel' },
  close: { ja: '閉じる', en: 'Close' },
  'dialog.nodeProps': { ja: '節点プロパティ', en: 'Node Properties' },
  'dialog.beamProps': { ja: '梁プロパティ', en: 'Beam Properties' },
  'dialog.pillarProps': { ja: '柱プロパティ', en: 'Pillar Properties' },
  'dialog.trussProps': { ja: 'トラスプロパティ', en: 'Truss Properties' },
  'dialog.springProps': { ja: 'ばねプロパティ', en: 'Spring Properties' },
  'dialog.supportProps': { ja: '支点プロパティ', en: 'Support Properties' },
  'dialog.constraintProps': { ja: '拘束プロパティ', en: 'Constraint Properties' },
  'dialog.floorProps': { ja: '床プロパティ', en: 'Floor Properties' },
  'dialog.wallProps': { ja: '壁プロパティ', en: 'Wall Properties' },
  'dialog.bearwallProps': { ja: '耐力壁プロパティ', en: 'BearWall Properties' },
  'dialog.planeProps': { ja: '面要素プロパティ', en: 'Plane Properties' },
  'dialog.layerAdd': { ja: 'レイヤー追加', en: 'Add Layer' },
  'dialog.layerEdit': { ja: 'レイヤー編集', en: 'Edit Layer' },
  'dialog.importInfo': { ja: '読込情報', en: 'Import Info' },
  'dialog.modelValidation': { ja: 'モデル検証', en: 'Model Validation' },
  'dialog.calcYamlImportMode': { ja: 'YAML読込モード', en: 'YAML Import Mode' },
  section: { ja: '断面', en: 'Section' },
  weight: { ja: '荷重', en: 'Weight' },
  direction: { ja: '方向', en: 'Direction' },
  name: { ja: '名前', en: 'Name' },
  zPosition: { ja: 'Z位置', en: 'Z Position' },
  'structural.nodeMass': { ja: '節点質量・回転慣性（6自由度）', en: 'Nodal mass and rotational inertia (6 DOF)' },
  'structural.enableMass': { ja: '質量を設定', en: 'Define nodal mass' },
  'structural.translation': { ja: '並進', en: 'translation' },
  'structural.rotation': { ja: '回転', en: 'rotation' },
  'structural.translationalMassUnit': { ja: '並進質量の単位', en: 'Translational mass unit' },
  'structural.rotationalInertiaUnit': { ja: '回転慣性の単位', en: 'Rotational inertia unit' },
  'structural.trussProperties': { ja: '軸剛性情報', en: 'Axial stiffness data' },
  'structural.material': { ja: '材料', en: 'Material' },
  'structural.area': { ja: '断面積', en: 'Area' },
  'structural.areaUnit': { ja: '断面積の単位', en: 'Area unit' },
  'structural.elasticModulus': { ja: 'ヤング係数（任意）', en: 'Elastic modulus (optional)' },
  'structural.stressUnit': { ja: '応力の単位', en: 'Stress unit' },
  'structural.springComponents': { ja: 'ばね剛性（6自由度）', en: 'Spring stiffness (6 DOF)' },
  'structural.enableDof': { ja: '有効', en: 'Enabled' },
  'structural.stiffness': { ja: '剛性', en: 'Stiffness' },
  'structural.unit': { ja: '単位', en: 'Unit' },
  'structural.springOrientation': { ja: 'ローカル軸（任意）', en: 'Local orientation (optional)' },
  'structural.enableOrientX': { ja: 'X方向ベクトルを設定', en: 'Define X orientation vector' },
  'structural.enableOrientY': { ja: 'Y方向ベクトルを設定', en: 'Define Y orientation vector' },
  'structural.shearDistance': { ja: 'せん断位置（任意、0〜1）', en: 'Shear distances (optional, 0 to 1)' },
  'structural.enableShearDistance': { ja: 'せん断位置を設定', en: 'Define shear distances' },
  'structural.note': { ja: '注記', en: 'Note' },
  'structural.fixedDofs': { ja: '固定自由度（6自由度）', en: 'Restrained DOFs (6 DOF)' },
  'structural.constraintKind': { ja: '拘束種別', en: 'Constraint kind' },
  'structural.slaveNode': { ja: '従属節点', en: 'Slave node' },
  'structural.slaveDof': { ja: '従属自由度', en: 'Slave DOF' },
  'structural.masterTerms': { ja: '主節点項', en: 'Master terms' },
  'structural.masterNode': { ja: '主節点', en: 'Master node' },
  'structural.masterDof': { ja: '主自由度', en: 'Master DOF' },
  'structural.coefficient': { ja: '係数', en: 'Coefficient' },

  // Messages
  'msg.confirmNew': { ja: '現在のデータを破棄して新規作成しますか？', en: 'Discard current data and create new?' },
  'msg.fileError': { ja: 'ファイル読込エラー: ', en: 'File load error: ' },
  'msg.unsupportedFileType': { ja: '未対応のファイル形式です', en: 'Unsupported file type' },
  'msg.duplicateLayer': {
    ja: '同一Z位置のレイヤーが既に存在します',
    en: 'A layer at the same Z position already exists',
  },
  'msg.defaultLayerName': { ja: '新規レイヤー', en: 'New Layer' },
  'msg.memberExists': { ja: '既に接続されたメンバーが存在します', en: 'A connected member already exists' },
  'msg.floorExists': { ja: '既に同一の床が存在します', en: 'The same floor already exists' },
  'msg.wallExists': { ja: '既に同一の壁が存在します', en: 'The same wall already exists' },
  'msg.bearwallExists': { ja: '既に同一の耐力壁が存在します', en: 'The same bearing wall already exists' },
  'validation.finiteNumber': { ja: '有限の数値を入力してください', en: 'Enter a finite number.' },
  'validation.requiredText': { ja: '空でない値を入力してください', en: 'Enter a non-empty value.' },
  'validation.positiveNumber': { ja: '0より大きい数値を入力してください', en: 'Enter a number greater than zero.' },
  'validation.nonNegativeNumber': { ja: '0以上の数値を入力してください', en: 'Enter a non-negative number.' },
  'validation.zeroToOne': { ja: '0以上1以下の数値を入力してください', en: 'Enter a number from 0 to 1.' },
  'validation.massDofCount': { ja: '質量は6自由度すべてを入力してください', en: 'Enter all six nodal mass DOFs.' },
  'validation.springDofRequired': {
    ja: 'ばね剛性を1自由度以上設定してください',
    en: 'Enable at least one spring DOF.',
  },
  'validation.supportDofRequired': {
    ja: '固定自由度を1つ以上選択してください',
    en: 'Select at least one restrained DOF.',
  },
  'validation.vectorNonZero': { ja: '方向ベクトルをゼロにできません', en: 'The orientation vector must be non-zero.' },
  'validation.vectorsNotParallel': {
    ja: 'X・Y方向ベクトルを平行にできません',
    en: 'X and Y orientation vectors must not be parallel.',
  },
  'validation.coefficientNonZero': { ja: '係数を0にできません', en: 'The coefficient must not be zero.' },
  'validation.duplicateConstraintTerm': {
    ja: '同じ主節点・自由度の項が重複しています',
    en: 'Duplicate master node and DOF term.',
  },
  'validation.selfConstraint': {
    ja: '従属自由度を同じ節点・自由度へ拘束できません',
    en: 'A slave DOF cannot reference itself.',
  },
  'validation.noIssues': { ja: 'エラーや警告はありません。', en: 'No errors or warnings were found.' },
  'validation.errors': { ja: 'エラー', en: 'Errors' },
  'validation.warnings': { ja: '警告', en: 'Warnings' },
  'validation.error': { ja: 'エラー', en: 'Error' },
  'validation.warning': { ja: '警告', en: 'Warning' },
  'validation.selectTargets': { ja: '対象を選択', en: 'Select targets' },

  // History labels
  'history.cadEdit': { ja: 'CAD編集', en: 'CAD edit' },
  'history.propertyEdit': { ja: 'プロパティ編集', en: 'Edit properties' },
  'history.moveNode': { ja: '節点移動', en: 'Move nodes' },
  'history.addNode': { ja: '節点追加', en: 'Add node' },
  'history.addBeam': { ja: '梁追加', en: 'Add beam' },
  'history.addPillar': { ja: '柱追加', en: 'Add pillar' },
  'history.addFloor': { ja: '床追加', en: 'Add floor' },
  'history.addWall': { ja: '壁追加', en: 'Add wall' },
  'history.addBearWall': { ja: '耐力壁追加', en: 'Add bearing wall' },
  'history.deleteSelection': { ja: '選択要素削除', en: 'Delete selected elements' },
  'history.addLayer': { ja: 'レイヤー追加', en: 'Add layer' },
  'history.editLayer': { ja: 'レイヤー編集', en: 'Edit layer' },
  'history.removeLayer': { ja: 'レイヤー削除', en: 'Remove layer' },
  'history.duplicateLayer': { ja: 'レイヤー複製', en: 'Duplicate layer' },
  'history.copyLayerElements': { ja: 'レイヤー要素コピー', en: 'Copy layer elements' },
  'history.layerVisibility': { ja: 'レイヤー表示変更', en: 'Change layer visibility' },
  'history.layerLock': { ja: 'レイヤーロック変更', en: 'Change layer lock' },
  'history.isolateLayer': { ja: 'レイヤー隔離', en: 'Isolate layer' },
  'history.showAllLayers': { ja: '全レイヤー表示', en: 'Show all layers' },

  // Help dialog
  'help.title': { ja: '操作マニュアル', en: 'Operation Manual' },
  'help.tools': { ja: 'ツール操作', en: 'Tool Operations' },
  'help.camera': { ja: 'カメラ操作', en: 'Camera Controls' },
  'help.data': { ja: 'データ形式', en: 'Data Format' },

  'help.select.name': { ja: '選択', en: 'Select' },
  'help.select.desc': {
    ja: 'クリック: 要素選択（Shift: 追加, Ctrl: 反転）\nドラッグ: 矩形選択\nダブルクリック: プロパティ表示',
    en: 'Click: select (Shift: add, Ctrl: toggle)\nDrag: box select\nDouble-click: properties',
  },
  'help.move.name': { ja: '移動', en: 'Move' },
  'help.move.desc': { ja: '選択した節点をクリックで移動先を指定', en: 'Click to set destination for selected nodes' },
  'help.addNode.name': { ja: '節点追加', en: 'Add Node' },
  'help.addNode.desc': { ja: 'クリック位置に節点を追加', en: 'Click to add a node at that position' },
  'help.addBeam.name': { ja: '梁追加', en: 'Add Beam' },
  'help.addBeam.desc': { ja: '2つの節点をクリックして梁を作成', en: 'Click two nodes to create a beam' },
  'help.addPillar.name': { ja: '柱追加', en: 'Add Pillar' },
  'help.addPillar.desc': {
    ja: 'クリック位置に柱を追加（現レイヤー→上レイヤー）',
    en: 'Click to add a pillar (current layer to upper layer)',
  },
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

  'help.data.desc': {
    ja: '保存形式はJSONです。構造解析用YAMLはCAD形状へ変換して読み込めます。\n座標系: X=右, Y=奥, Z=上（mm単位）',
    en: 'JSON is the save format. Structural analysis YAML can be imported by converting it to CAD geometry.\nCoordinates: X=right, Y=depth, Z=up (mm unit)',
  },

  // Import info
  'import.summary': { ja: '概要', en: 'Summary' },
  'import.mode': { ja: '読込モード', en: 'Import mode' },
  'import.modelName': { ja: 'モデル名', en: 'Model' },
  'import.sourceJson': { ja: '元JSON', en: 'Source JSON' },
  'import.analysisProfile': { ja: '解析プロファイル', en: 'Analysis profile' },
  'import.units': { ja: '単位', en: 'Units' },
  'import.counts': { ja: '件数', en: 'Counts' },
  'import.item': { ja: '項目', en: 'Item' },
  'import.value': { ja: '値', en: 'Value' },
  'import.sourceIdMap': { ja: '元ID対応', en: 'Source ID Map' },
  'import.kind': { ja: '分類', en: 'Kind' },
  'import.type': { ja: '種類', en: 'Type' },
  'import.sourceId': { ja: '元ID', en: 'Source ID' },
  'import.sourceType': { ja: '元種類', en: 'Source Type' },
  'import.appNumber': { ja: 'アプリ番号', en: 'App No.' },
  'import.detail': { ja: '詳細', en: 'Detail' },
  'import.materials': { ja: '材料', en: 'Materials' },
  'import.sections': { ja: '断面性能', en: 'Sections' },
  'import.material': { ja: '材料', en: 'Material' },
  'import.elementTags': { ja: '解析要素タグ', en: 'Element Tags' },
  'import.warnings': { ja: '警告', en: 'Warnings' },
  'import.noWarnings': { ja: '警告はありません', en: 'No warnings' },
  'import.code': { ja: 'コード', en: 'Code' },
  'import.path': { ja: 'パス', en: 'Path' },
  'import.message': { ja: 'メッセージ', en: 'Message' },
  'importMode.description': {
    ja: '構造解析用YAMLの表示方法を選択してください。元CAD形状は従来の床・部材として復元し、生成済み解析要素は置換後の節点・線材を表示します。',
    en: 'Choose how to display the structural analysis YAML. Source CAD restores the original floors and members; generated elements displays the replaced analysis nodes and line elements.',
  },
  'importMode.source': { ja: '元CAD形状', en: 'Source CAD' },
  'importMode.generated': { ja: '生成済み解析要素', en: 'Generated elements' },
} as const;

/** 翻訳キー（messages のキーに限定。タイポはコンパイルエラーになる） */
export type MessageKey = keyof typeof messages;
export type HistoryMessageKey = Extract<MessageKey, `history.${string}`>;

export function t(key: MessageKey): string {
  const entry = messages[key];
  if (!entry) return key;
  return entry[currentLocale] ?? entry.ja ?? key;
}

/** 履歴へ保存した安定キーを現在localeへ変換し、任意ラベルはそのまま表示する。 */
export function translateHistoryLabel(label: string): string {
  if (label.startsWith('history.') && label in messages) return t(label as MessageKey);
  return label;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  updateDom();
  legacyLocaleChanged?.();
  for (const listener of [...localeChangeListeners]) listener(locale);
}

export function toggleLocale(): void {
  setLocale(currentLocale === 'ja' ? 'en' : 'ja');
}

export function setOnLocaleChanged(callback: () => void): void {
  legacyLocaleChanged = callback;
}

/** Controllerや表示部品が独立してlocale変更を購読できる。 */
export function subscribeLocaleChanged(listener: (locale: Locale) => void): () => void {
  localeChangeListeners.add(listener);
  return () => localeChangeListeners.delete(listener);
}

/**
 * data 属性ごとの更新ルール。属性値を MessageKey とみなし apply で要素へ反映する。
 * label/after はテキストノード走査を含むため、各 apply 内で従来の挙動を厳密に維持する。
 */
const domUpdateRules: { attr: string; apply: (el: Element, text: string) => void }[] = [
  {
    attr: 'data-i18n',
    apply: (el, text) => {
      el.textContent = text;
    },
  },
  {
    attr: 'data-i18n-title',
    apply: (el, text) => {
      (el as HTMLElement).title = text;
    },
  },
  {
    attr: 'data-i18n-aria-label',
    apply: (el, text) => {
      el.setAttribute('aria-label', text);
    },
  },
  {
    // ラベル "text: input" 形式: ラベル直下のテキストノードを更新
    attr: 'data-i18n-label',
    apply: (el, text) => {
      const label = el as HTMLLabelElement;
      const input = label.querySelector('input, select');
      if (input) {
        let updated = false;
        label.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = updated ? '' : text + ' ';
            updated = true;
          }
        });
      }
    },
  },
  {
    // チェックボックスラベル: input 直後のテキストノードを更新
    attr: 'data-i18n-after',
    apply: (el, text) => {
      const label = el as HTMLLabelElement;
      const input = label.querySelector('input');
      if (input && input.nextSibling) {
        input.nextSibling.textContent = ' ' + text;
      }
    },
  },
];

/** data-i18n 系属性を持つ全要素のテキストを更新 */
export function updateDom(): void {
  document.documentElement.lang = currentLocale;
  for (const { attr, apply } of domUpdateRules) {
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const key = el.getAttribute(attr) as MessageKey;
      apply(el, t(key));
    });
  }
}

/** 初期化: DOMロード後に呼ぶ */
export function initI18n(): void {
  updateDom();
}
