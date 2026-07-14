/**
 * CADビューの描画パラメータとカラーパレットの一元定義。
 * マジックナンバー・ハードコード色をここに集約する（T-6）。
 */

/** 描画・操作の定数（ピクセル/感度/距離など） */
export const CAD = {
  /** ノード点のサイズ(px) */
  NODE_SIZE: 6,
  /** プレビュー点のサイズ(px) */
  PREVIEW_POINT_SIZE: 8,
  /** 部材線の太さ */
  MEMBER_LINEWIDTH: 2,
  /** Node/線材のヒットテスト許容幅（CSS px） */
  HIT_TOLERANCE_PX: 8,
  /** オブジェクトスナップの許容幅（CSS px） */
  OBJECT_SNAP_TOLERANCE_PX: 10,
  /** 柱円の半径 = cameraDistance に対する比率 */
  PILLAR_RADIUS_RATIO: 0.005,
  /** ダブルクリック判定の時間しきい値(ms) */
  DBLCLICK_MS: 400,
  /** ダブルクリック判定の距離しきい値(px) */
  DBLCLICK_PX: 10,
  /** クリックとドラッグを区別する移動量（CSS px） */
  DRAG_THRESHOLD_PX: 4,
  /** 3D回転の感度 */
  ROTATE_SENSITIVITY: 0.01,
  /** パン量の分母（大きいほど鈍い） */
  PAN_DENOM: 500,
  /** ホイールズームの倍率 */
  ZOOM_FACTOR: 1.15,
  /** カメラ距離の最小・最大クランプ */
  MIN_DISTANCE: 10,
  MAX_DISTANCE: 100000,
  /** グリッド描画範囲 = cameraDistance に対する比率 */
  GRID_RANGE_RATIO: 2,
  /** グリッド線の最大本数（片方向あたり）。ズームアウト時の過剰生成を抑制 */
  MAX_GRID_LINES: 400,
  /** 高DPI端末でGPU負荷が過大にならないようにするpixel ratio上限 */
  MAX_PIXEL_RATIO: 2,
  /** fit時にモデル外周へ確保する余白率 */
  FIT_PADDING: 1.15,
} as const;

/** Canvas 描画に使う色（テーマ別） */
export interface CadPalette {
  background: number;
  grid: number;
  axisX: number;
  axisY: number;
  /** 選択中の要素 */
  select: number;
  /** 通常のノード */
  node: number;
  /** 通常の部材（梁・柱・耐力壁） */
  member: number;
  /** 壁 */
  wall: number;
  /** プレビュー（要素追加中の仮表示） */
  preview: number;
  /** 矩形選択の枠 */
  selectionRect: number;
}

const LIGHT_PALETTE: CadPalette = {
  background: 0xffffff,
  grid: 0xa0a0a0,
  axisX: 0xff0000,
  axisY: 0x00aa00,
  select: 0xff0000,
  node: 0x0000ff,
  member: 0x0000ff,
  wall: 0x00aa00,
  preview: 0xff0000,
  selectionRect: 0x0000ff,
};

const DARK_PALETTE: CadPalette = {
  background: 0x1e1e1e,
  grid: 0x3a3a3a,
  axisX: 0xff6666,
  axisY: 0x55cc66,
  select: 0xff6666,
  node: 0x66aaff,
  member: 0x66aaff,
  wall: 0x44bb66,
  preview: 0xff6666,
  selectionRect: 0x66aaff,
};

/** 現在のテーマがダークかどうか（main.ts の data-theme 属性に追従） */
export function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
}

/** 現在のテーマに対応するパレットを返す */
export function getPalette(): CadPalette {
  return isDarkTheme() ? DARK_PALETTE : LIGHT_PALETTE;
}
