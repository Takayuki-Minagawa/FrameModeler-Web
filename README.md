# FrameModeler-Web

**Ver.1.0.0**

建築構造フレームモデリング CAD ツールの Web アプリケーション版です。
ブラウザ上で節点・梁・柱・床・壁・耐力壁を配置・編集し、3D で確認できます。

## 機能

- 節点 (Node)、梁 (Beam)、柱 (Pillar)、床 (Floor)、壁 (Wall)、耐力壁 (BearWall) の配置・編集
- 2D 平面図 / 3D パース表示の切替
- レイヤー（階）による管理
- グリッド表示・スナップ機能
- JSON 形式でのデータ保存・読込
- 構造解析用 YAML からの CAD 形状変換読込
- マウス操作によるパン・ズーム・回転
- 多言語対応（日本語 / English）
- ダークモード / ライトモード切替
- アプリ内操作マニュアル

## 技術スタック

| 項目 | 技術 |
|------|------|
| 言語 | TypeScript |
| ビルド | Vite |
| 3D 描画 | Three.js (WebGL) |
| UI | HTML + CSS |
| データ形式 | JSON（保存形式） / YAML（解析データ読込） |
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

### ツールバー

| ボタン | 機能 |
|--------|------|
| EN / JA | 表示言語の切替（日本語 ⇔ English） |
| ☾ / ☀ | ダークモード / ライトモード切替 |
| ? | 操作マニュアルの表示 |

言語とテーマの設定はブラウザに保存され、次回アクセス時にも維持されます。

## データ形式

JSON 形式でモデルデータを保存・読込します。保存形式は JSON です。

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

### 構造解析用 YAML の読込

`schema_version`, `units`, `model`, `traceability` を持つ構造解析用 YAML を読み込み、CAD 表示用の節点・梁・床・レイヤーへ変換できます。

- 対応拡張子: `.yaml`, `.yml`
- 読み込み後の保存形式: JSON
- 変換方針: 読込時に「元 CAD 形状」または「生成済み解析要素」を選択
  - 元 CAD 形状: `traceability` を優先し、解析メッシュではなく元 CAD 形状に近い形で復元
  - 生成済み解析要素: `model.nodes` / `model.elements` を節点・線材として表示
- 確認可能な情報: 元節点 ID、元部材 ID、section、material、材料特性、断面特性
- 未対応情報: 支点、節点質量、拘束、ばね要素、解析結果抽出設定

未対応情報は読み込み情報ダイアログの警告として表示されます。材料特性・断面特性は確認用に表示されますが、現行 JSON 保存形式には保存されません。生成済み解析要素モードでは `elasticTimoshenkoBeam3D`, `truss3D`, `twoNodeLink3D` を表示用の梁として読み込みます。

## サンプルデータ

`sample-data/` ディレクトリにサンプルファイルが含まれています。

| ファイル | 内容 |
|----------|------|
| `pillar_test.json` | 小規模モデル（19 節点, 3 梁, 9 柱, 2 層） |
| `test.json` | 大規模モデル（88 節点, 32 梁, 37 柱, 壁/床あり, 3 層） |
| `Test0202_calc.yaml` | 構造解析用 YAML 読込テスト（元 CAD 形状: 10 節点, 6 梁, 4 床, 1 層 / 生成済み解析要素: 76 節点, 79 梁, 0 床, 1 層） |

## ディレクトリ構成

```
src/
├── main.ts           # エントリポイント
├── i18n.ts           # 多言語対応モジュール
├── data/             # データモデル
├── math/             # Point3D, Point2D
├── io/               # JSON 入出力
├── ui/               # CadView, CadRenderer, ハンドラ, ダイアログ
│   ├── handlers/     # マウスハンドラ
│   └── dialogs/      # プロパティダイアログ, ヘルプダイアログ
└── styles/           # CSS
```

## ライセンス

All rights reserved.
