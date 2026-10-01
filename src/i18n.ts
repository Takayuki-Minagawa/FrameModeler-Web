import type { DocumentDataKind } from './data/DocumentData';

export type Locale = 'ja' | 'en';

const STORAGE_KEY = 'framemodeler-locale';

// data層やnode環境のテストからも翻訳を参照できるよう、localStorageが無い環境では既定localeを使う。
const storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage;
let currentLocale: Locale = storage?.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ja';
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
  measure: { ja: '計測', en: 'Measure' },
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
  'title.select': { ja: '選択 (1)', en: 'Select (1)' },
  'title.move': { ja: '節点移動 (2)', en: 'Move nodes (2)' },
  'title.node': { ja: '節点追加 (3)', en: 'Add Node (3)' },
  'title.beam': { ja: '梁追加 (4)', en: 'Add Beam (4)' },
  'title.pillar': { ja: '柱追加 (5)', en: 'Add Pillar (5)' },
  'title.floor': { ja: '床追加 (6)', en: 'Add Floor (6)' },
  'title.wall': { ja: '壁追加 (7)', en: 'Add Wall (7)' },
  'title.bearwall': { ja: '耐力壁追加 (8)', en: 'Add BearWall (8)' },
  'title.measure': { ja: '2点間の距離を計測 (9)', en: 'Measure the distance between two points (9)' },
  'title.undo': { ja: '元に戻す (Ctrl/Cmd+Z)', en: 'Undo (Ctrl/Cmd+Z)' },
  'title.redo': { ja: 'やり直す (Ctrl+Y / Cmd+Shift+Z)', en: 'Redo (Ctrl+Y / Cmd+Shift+Z)' },
  'title.delete': { ja: '選択要素を削除 (Delete)', en: 'Delete selected (Delete)' },
  'edit.menu': { ja: '編集', en: 'Edit' },
  'edit.selectAll': { ja: '全選択', en: 'Select all' },
  'title.selectAll': { ja: '表示中の要素をすべて選択 (Ctrl/Cmd+A)', en: 'Select every visible element (Ctrl/Cmd+A)' },
  'edit.invertSelection': { ja: '選択反転', en: 'Invert selection' },
  'title.invertSelection': { ja: '選択と非選択を入れ替える (Ctrl/Cmd+I)', en: 'Invert the selection (Ctrl/Cmd+I)' },
  'edit.arrayCopy': { ja: '配列複写…', en: 'Array copy…' },
  'title.arrayCopy': {
    ja: '選択要素を一定間隔で繰り返し複写 (Ctrl/Cmd+D)',
    en: 'Repeat the selection at a fixed offset (Ctrl/Cmd+D)',
  },
  'edit.mergeNodes': { ja: '重複節点を結合…', en: 'Merge coincident nodes…' },
  'title.mergeNodes': {
    ja: '近接した節点を1つにまとめ、参照を付け替える',
    en: 'Merge nodes within a tolerance and re-point their references',
  },
  'edit.removeOrphanNodes': { ja: '孤立節点を削除', en: 'Remove orphan nodes' },
  'title.removeOrphanNodes': {
    ja: 'どの要素からも参照されていない節点を削除',
    en: 'Delete nodes that no element references',
  },
  'export.menu': { ja: '出力', en: 'Export' },
  'export.summary': { ja: '数量集計…', en: 'Quantities…' },
  'title.exportSummary': {
    ja: '種別・断面ごとの本数、延長、面積を集計',
    en: 'Count, total length and area per type and section',
  },
  'export.png': { ja: 'PNG画像', en: 'PNG image' },
  'title.exportPng': { ja: '現在の表示を画像として保存', en: 'Save the current view as an image' },
  'export.dxf': { ja: 'DXF', en: 'DXF' },
  'title.exportDxf': {
    ja: '平面表示では現在の階の伏図、3D・立面表示ではモデル全体をDXF (R12, mm) で保存',
    en: 'Save the current storey plan (plan view) or the whole model (3D / elevation) as DXF (R12, mm)',
  },
  'export.nodesCsv': { ja: '節点CSV', en: 'Nodes CSV' },
  'title.exportNodesCsv': { ja: '節点番号と座標をCSVで保存', en: 'Save node numbers and coordinates as CSV' },
  'export.elementsCsv': { ja: '要素CSV', en: 'Elements CSV' },
  'title.exportElementsCsv': {
    ja: '部材・面材・支点・拘束の一覧をCSVで保存',
    en: 'Save members, planes, supports and constraints as CSV',
  },
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
  'title.duplicateLayer': { ja: 'レイヤー複製', en: 'Duplicate layer' },
  'title.copyLayerUp': { ja: '上階へコピー', en: 'Copy to the layer above' },
  'title.copyLayerDown': { ja: '下階へコピー', en: 'Copy to the layer below' },
  'title.showAllLayers': { ja: '全レイヤー表示', en: 'Show all layers' },
  'layer.hide': { ja: 'レイヤーを非表示', en: 'Hide layer' },
  'layer.show': { ja: 'レイヤーを表示', en: 'Show layer' },
  'layer.lock': { ja: 'レイヤーをロック', en: 'Lock layer' },
  'layer.unlock': { ja: 'レイヤーのロックを解除', en: 'Unlock layer' },
  'layer.isolate': { ja: 'このレイヤーだけ表示', en: 'Isolate layer' },
  'layer.state.visible': { ja: '表示', en: 'visible' },
  'layer.state.hidden': { ja: '非表示', en: 'hidden' },
  'layer.state.locked': { ja: 'ロック中', en: 'locked' },
  'layer.state.editable': { ja: '編集可', en: 'editable' },

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
  'aria.selectionFilter': { ja: '選択対象', en: 'Selectable types' },
  'aria.displayLabels': { ja: '表示ラベル', en: 'Displayed labels' },
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
  'dialog.arrayCopy': { ja: '配列複写', en: 'Array Copy' },
  'dialog.mergeNodes': { ja: '重複節点の結合', en: 'Merge Coincident Nodes' },
  'dialog.summary': { ja: '数量集計', en: 'Quantities' },
  'arrayCopy.description': {
    ja: '選択した要素を指定した間隔で繰り返し複写します。複写先に節点や同じ要素が既にあれば再利用し、重複して作りません。',
    en: 'Repeats the selection at the given offset. Existing nodes and identical elements at the destination are reused instead of duplicated.',
  },
  'arrayCopy.dx': { ja: 'ΔX (mm)', en: 'ΔX (mm)' },
  'arrayCopy.dy': { ja: 'ΔY (mm)', en: 'ΔY (mm)' },
  'arrayCopy.dz': { ja: 'ΔZ (mm)', en: 'ΔZ (mm)' },
  'arrayCopy.count': { ja: '個数', en: 'Copies' },
  'mergeNodes.description': {
    ja: '指定した距離以内にある節点を1つにまとめ、部材・面材・支点・拘束の参照を付け替えます。零長ばねや拘束で互いに結ばれた節点、双方に質量がある節点、ロック中の階の節点、結合すると部材長が0になる・面が平面でなくなる節点は結合しません。',
    en: 'Merges nodes within the given distance and re-points members, planes, supports and constraints. Nodes joined to each other by a zero-length spring or a constraint, nodes that both carry mass, nodes on locked layers, and nodes whose merge would collapse a member or bend a plane are left as they are.',
  },
  'mergeNodes.tolerance': { ja: '許容距離 (mm)', en: 'Tolerance (mm)' },
  'summary.counts': { ja: '要素数', en: 'Element counts' },
  'summary.members': { ja: '線材（種別・断面別）', en: 'Members by type and section' },
  'summary.planes': { ja: '面材（種別・断面別）', en: 'Planes by type and section' },
  'summary.extent': { ja: 'モデル範囲 (mm)', en: 'Model extent (mm)' },
  'summary.kind': { ja: '種別', en: 'Type' },
  'summary.count': { ja: '数', en: 'Count' },
  'summary.totalLength': { ja: '延長 (m)', en: 'Length (m)' },
  'summary.totalArea': { ja: '面積 (m²)', en: 'Area (m²)' },
  'summary.total': { ja: '合計', en: 'Total' },
  'summary.unassigned': { ja: '（未設定）', en: '(none)' },
  'summary.none': { ja: '該当する要素はありません。', en: 'No elements.' },
  'summary.min': { ja: '最小', en: 'Min' },
  'summary.max': { ja: '最大', en: 'Max' },
  'summary.size': { ja: '寸法', en: 'Size' },
  'summary.exportCsv': { ja: 'CSVを保存', en: 'Save CSV' },
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
  'msg.nothingSelected': { ja: '要素が選択されていません。', en: 'No elements are selected.' },
  'msg.copyResult': {
    ja: '{nodes}節点、{elements}要素を追加しました',
    en: 'Added {nodes} node(s) and {elements} element(s)',
  },
  'msg.copyNothing': {
    ja: '複写先に同じ要素が既にあるため、追加はありませんでした',
    en: 'Nothing was added because identical elements already exist at the destination',
  },
  'msg.copyFailed': { ja: '複写できませんでした: {message}', en: 'The copy failed: {message}' },
  'msg.mergeResult': {
    ja: '{nodes}個の節点を結合し、重複した{elements}要素を削除しました',
    en: 'Merged {nodes} node(s) and removed {elements} duplicate element(s)',
  },
  'msg.mergeNothing': { ja: '結合できる節点はありませんでした', en: 'No nodes could be merged' },
  'msg.mergeFailed': { ja: '節点を結合できませんでした: {message}', en: 'The nodes could not be merged: {message}' },
  'msg.noOrphans': { ja: '孤立節点はありません', en: 'There are no orphan nodes' },
  'msg.confirmRemoveOrphans': {
    ja: 'どの要素からも参照されていない節点{count}個を削除しますか？',
    en: 'Delete {count} node(s) that no element references?',
  },
  'msg.orphansRemoved': { ja: '孤立節点を{count}個削除しました', en: 'Removed {count} orphan node(s)' },
  'msg.exportFailed': { ja: '出力に失敗しました: {message}', en: 'The export failed: {message}' },
  'msg.exported': { ja: '{name} を保存しました', en: 'Saved {name}' },
  'measure.result': {
    ja: '距離 {distance} mm（ΔX {dx} / ΔY {dy} / ΔZ {dz}）',
    en: 'Distance {distance} mm (ΔX {dx} / ΔY {dy} / ΔZ {dz})',
  },
  'msg.applyChangeFailed': {
    ja: '変更を適用できませんでした: {message}',
    en: 'The change could not be applied: {message}',
  },
  'msg.confirmOpen': {
    ja: '未保存の変更を破棄してファイルを開きますか？',
    en: 'Discard unsaved changes and open another file?',
  },
  'msg.fileReadFailed': { ja: 'ファイルを読み取れませんでした', en: 'File read failed' },
  'msg.nodeReferenced': {
    ja: '節点 {node} は {type} {number} から参照されています',
    en: 'Node {node} is referenced by {type} {number}',
  },
  'msg.deleteBlocked': { ja: '削除できません:\n{details}', en: 'Delete failed:\n{details}' },
  'msg.confirmDelete': { ja: '選択した{count}要素を削除しますか？', en: 'Delete {count} selected element(s)?' },
  'msg.deleteFailed': { ja: '削除できませんでした:\n{message}', en: 'Delete failed:\n{message}' },
  'msg.firstPointRequired': {
    ja: '先に1点目を指定してください。',
    en: 'Specify the first point before distance/angle input.',
  },
  'msg.confirmRestoreDraft': { ja: '{when} の未保存データを復旧しますか？', en: 'Restore unsaved data from {when}?' },
  'msg.draftInvalid': {
    ja: '復旧データを読み込めなかったため破棄しました: {message}',
    en: 'The recovery draft was invalid and has been discarded: {message}',
  },
  'msg.layerLockedEdit': { ja: 'ロック中のレイヤーは編集できません。', en: 'A locked layer cannot be edited.' },
  'msg.layerLockedDelete': { ja: 'ロック中のレイヤーは削除できません。', en: 'A locked layer cannot be deleted.' },
  'msg.confirmDeleteLayer': {
    ja: 'レイヤー「{name}」を削除しますか？（関連要素: {count}）',
    en: 'Delete layer "{name}"? ({count} related elements)',
  },
  'msg.noAdjacentLayer': { ja: 'コピー先の隣接レイヤーがありません。', en: 'There is no adjacent target layer.' },
  'msg.targetLayerLocked': { ja: 'コピー先レイヤーはロックされています。', en: 'The target layer is locked.' },
  'msg.layerOperationFailed': {
    ja: 'レイヤー操作に失敗しました: {message}',
    en: 'Layer operation failed: {message}',
  },
  'workPlane.viewport-unavailable': {
    ja: '表示領域のサイズが0のため操作できません',
    en: 'The view has no size, so it cannot be operated',
  },
  'workPlane.parallel': {
    ja: '視線が現在レイヤーの作業平面と平行なため配置できません',
    en: 'The view direction is parallel to the work plane of the current layer',
  },
  'workPlane.behind': {
    ja: '現在レイヤーの作業平面がカメラ後方にあるため配置できません',
    en: 'The work plane of the current layer is behind the camera',
  },
  'validation.finiteNumber': { ja: '有限の数値を入力してください', en: 'Enter a finite number.' },
  'validation.requiredText': { ja: '空でない値を入力してください', en: 'Enter a non-empty value.' },
  'validation.positiveNumber': { ja: '0より大きい数値を入力してください', en: 'Enter a number greater than zero.' },
  'validation.nonNegativeNumber': { ja: '0以上の数値を入力してください', en: 'Enter a non-negative number.' },
  'validation.zeroToOne': { ja: '0以上1以下の数値を入力してください', en: 'Enter a number from 0 to 1.' },
  'validation.copyCount': { ja: '1以上{max}以下の整数を入力してください', en: 'Enter an integer from 1 to {max}.' },
  'validation.offsetNonZero': {
    ja: 'ΔX・ΔY・ΔZのいずれかを0以外にしてください',
    en: 'At least one of ΔX, ΔY and ΔZ must be non-zero.',
  },
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
  'history.arrayCopy': { ja: '配列複写', en: 'Array copy' },
  'history.mergeNodes': { ja: '重複節点結合', en: 'Merge nodes' },
  'history.removeOrphanNodes': { ja: '孤立節点削除', en: 'Remove orphan nodes' },
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
  'help.measure.name': { ja: '計測', en: 'Measure' },
  'help.measure.desc': {
    ja: '2点をクリックして距離と ΔX / ΔY / ΔZ を表示\n節点をクリックするとその節点の座標を使うため、3D・立面でも階をまたいで測れる',
    en: 'Click two points to show the distance and ΔX / ΔY / ΔZ\nClicking a node uses its coordinates, so storeys can be spanned in 3D and elevation views',
  },
  'help.edit': { ja: '編集と出力', en: 'Editing and Export' },
  'help.arrayCopy.name': { ja: '配列複写', en: 'Array copy' },
  'help.arrayCopy.desc': {
    ja: '選択要素を ΔX / ΔY / ΔZ の間隔で指定個数だけ複写\n複写先の既存節点は再利用し、同じ要素は重複して作らない',
    en: 'Repeat the selection by ΔX / ΔY / ΔZ for the given number of copies\nExisting nodes are reused and identical elements are not duplicated',
  },
  'help.mergeNodes.name': { ja: '重複節点の結合', en: 'Merge nodes' },
  'help.mergeNodes.desc': {
    ja: '許容距離以内の節点を1つにまとめる\n結合で完全に同じになった梁・柱・面材は1つだけ残す',
    en: 'Merge nodes within a tolerance\nBeams, pillars and planes that become identical are kept only once',
  },
  'help.removeOrphans.name': { ja: '孤立節点の削除', en: 'Remove orphan nodes' },
  'help.removeOrphans.desc': {
    ja: 'どの要素からも参照されていない節点を削除',
    en: 'Delete nodes that no element references',
  },
  'help.summary.name': { ja: '数量集計', en: 'Quantities' },
  'help.summary.desc': {
    ja: '種別・断面ごとの本数、延長 (m)、面積 (m²) を表示し、CSVで保存',
    en: 'Count, length (m) and area (m²) per type and section, with CSV export',
  },
  'help.export.name': { ja: '出力', en: 'Export' },
  'help.export.desc': {
    ja: 'PNG: 現在の表示を画像で保存\nDXF: 平面表示では現在の階の伏図、3D・立面表示ではモデル全体（R12, mm）\nCSV: 節点一覧、要素一覧',
    en: 'PNG: save the current view as an image\nDXF: the current storey plan in plan view, the whole model in 3D / elevation (R12, mm)\nCSV: node list and element list',
  },
  'help.shortcuts': { ja: 'キーボードショートカット', en: 'Keyboard Shortcuts' },
  'help.shortcut.tools': { ja: '1 〜 9', en: '1 to 9' },
  'help.shortcut.tools.desc': {
    ja: 'ツール切替（選択・移動・節点・梁・柱・床・壁・耐力壁・計測）',
    en: 'Switch tool (select, move, node, beam, pillar, floor, wall, bearing wall, measure)',
  },
  'help.shortcut.file': { ja: 'Ctrl/Cmd + S / O', en: 'Ctrl/Cmd + S / O' },
  'help.shortcut.file.desc': { ja: '保存 / 開く', en: 'Save / Open' },
  'help.shortcut.history': { ja: 'Ctrl/Cmd + Z / Y', en: 'Ctrl/Cmd + Z / Y' },
  'help.shortcut.history.desc': {
    ja: '元に戻す / やり直す（Cmd+Shift+Z も可）',
    en: 'Undo / Redo (Cmd+Shift+Z also redoes)',
  },
  'help.shortcut.selection': { ja: 'Ctrl/Cmd + A / I', en: 'Ctrl/Cmd + A / I' },
  'help.shortcut.selection.desc': { ja: '全選択 / 選択反転', en: 'Select all / Invert selection' },
  'help.shortcut.copy': { ja: 'Ctrl/Cmd + D', en: 'Ctrl/Cmd + D' },
  'help.shortcut.copy.desc': { ja: '配列複写', en: 'Array copy' },
  'help.shortcut.delete': { ja: 'Delete', en: 'Delete' },
  'help.shortcut.delete.desc': { ja: '選択要素を削除', en: 'Delete the selection' },
  'help.shortcut.escape': { ja: 'Esc', en: 'Esc' },
  'help.shortcut.escape.desc': { ja: '途中の操作を取り消す', en: 'Cancel the operation in progress' },
  'help.shortcut.fit': { ja: 'Home / F', en: 'Home / F' },
  'help.shortcut.fit.desc': { ja: 'モデル全体を表示', en: 'Fit the model to the view' },
  'help.shortcut.snap': { ja: 'Tab / Alt', en: 'Tab / Alt' },
  'help.shortcut.snap.desc': {
    ja: 'スナップ候補の切替 / 押している間スナップ無効',
    en: 'Cycle snap candidates / Disable snapping while held',
  },
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

export type MessageParams = Readonly<Record<string, string | number>>;

/** 現在localeの文言を返す。`{name}` 形式のplaceholderは params の値で置換する。 */
export function t(key: MessageKey, params?: MessageParams): string {
  const entry = messages[key];
  if (!entry) return key;
  const text: string = entry[currentLocale] ?? entry.ja ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

const KIND_MESSAGE_KEYS: Record<DocumentDataKind, MessageKey> = {
  node: 'node',
  beam: 'beam',
  pillar: 'pillar',
  truss: 'truss',
  spring: 'spring',
  support: 'support',
  constraint: 'constraint',
  floor: 'floor',
  wall: 'wall',
  bearWall: 'bearwall',
};

/** モデル種別の表示名。data層の typeText（日本語固定）に代えてUIで使う。 */
export function kindLabel(kind: DocumentDataKind): string {
  return t(KIND_MESSAGE_KEYS[kind]);
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
  storage?.setItem(STORAGE_KEY, locale);
  if (typeof document !== 'undefined') updateDom();
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
