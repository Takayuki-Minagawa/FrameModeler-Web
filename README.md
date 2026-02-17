# FrameModeler-Web

建築構造フレームモデリング CAD ツールの Web アプリケーション版です。
ブラウザ上で節点・梁・柱・床・壁・耐力壁を配置・編集し、3D で確認できます。

## 機能

- 節点 (Node)、梁 (Beam)、柱 (Pillar)、床 (Floor)、壁 (Wall)、耐力壁 (BearWall) の配置・編集
- 2D 平面図 / 3D パース表示の切替
- レイヤー（階）による管理
- グリッド表示・スナップ機能
- JSON 形式でのデータ保存・読込
- マウス操作によるパン・ズーム・回転

## 技術スタック

| 項目 | 技術 |
|------|------|
| 言語 | TypeScript |
| ビルド | Vite |
| 3D 描画 | Three.js (WebGL) |
| UI | HTML + CSS |
| データ形式 | JSON |
| デプロイ | GitHub Pages |

## セットアップ

```bash
npm install          # 依存パッケージインストール
npm run dev          # 開発サーバー起動
npm run build        # 本番ビルド
npm run preview      # ビルド結果プレビュー
```

## 操作方法

### ツール

| ツール | 操作 |
|--------|------|
| 選択 | クリックで要素選択（Shift: 追加, Ctrl: 反転）、ドラッグで矩形選択、ダブルクリックでプロパティ表示 |
| 移動 | 選択した節点をクリックで移動 |
| 節点追加 | クリック位置に節点を追加 |
| 梁追加 | 2 つの節点をクリックして梁を追加 |
| 柱追加 | クリック位置に柱を追加（現レイヤーから上レイヤーまで） |
| 床追加 | 2 点クリックで矩形の床を追加 |
| 壁追加 | 2 点クリックで壁を追加 |
| 耐力壁追加 | 2 点クリックで耐力壁を追加 |

### カメラ操作

| 操作 | 動作 |
|------|------|
| 右ドラッグ | 2D: パン / 3D: 回転 |
| 中央ドラッグ | パン |
| ホイール | ズーム |

## データ形式

JSON 形式でモデルデータを保存・読込します。

```json
{
  "nodes": [
    { "number": 0, "pos": { "x": 0, "y": 0, "z": 200 }, "select": false }
  ],
  "beams": [
    { "number": 0, "nodeI": 0, "nodeJ": 1, "select": false, "section": "G1" }
  ],
  "pillars": [
    { "number": 0, "nodeI": 0, "nodeJ": 1, "select": false, "section": "C1" }
  ],
  "floors": [
    { "number": 0, "nodes": [0, 1, 2, 3], "select": false, "weight": 0, "direction": "X", "section": "S1" }
  ],
  "walls": [
    { "number": 0, "nodes": [0, 1, 2, 3], "select": false, "weight": 0 }
  ],
  "bearWalls": [
    { "number": 0, "nodes": [0, 1, 2, 3], "select": false }
  ],
  "layers": [
    { "name": "1F", "posZ": 0 },
    { "name": "2F", "posZ": 3000 }
  ]
}
```

### 座標系

- X 軸: 右方向
- Y 軸: 奥行き方向
- Z 軸: 高さ方向（上）
- 単位: mm

## サンプルデータ

`sample-data/` ディレクトリにサンプルファイルが含まれています。

| ファイル | 内容 |
|----------|------|
| `pillar_test.json` | 小規模モデル（19 節点, 3 梁, 9 柱, 2 層） |
| `test.json` | 大規模モデル（88 節点, 32 梁, 37 柱, 壁/床あり, 3 層） |

## ディレクトリ構成

```
src/
├── main.ts           # エントリポイント
├── data/             # データモデル
├── math/             # Point3D, Point2D
├── io/               # JSON 入出力
├── ui/               # CadView, CadRenderer, ハンドラ, ダイアログ
│   ├── handlers/     # マウスハンドラ
│   └── dialogs/      # プロパティダイアログ
└── styles/           # CSS
```

## ライセンス

All rights reserved.
