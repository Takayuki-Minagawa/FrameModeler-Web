# FrameModeler-Web

**Ver.1.0.0**

建築構造フレームモデリング CAD ツールの Web アプリケーション版です。ブラウザ上で節点・線材・面材を配置・編集し、構造解析用 YAML のトラス、ばね、支点、節点質量、拘束を保持したまま 2D / 3D で確認できます。GitHub Pages へ静的サイトとして配布します。

## 機能

- 節点 (Node)、梁 (Beam)、柱 (Pillar)、床 (Floor)、壁 (Wall)、耐力壁 (BearWall) の配置・編集
- トラス (Truss)、ばね (Spring)、支点 (Support)、6 自由度節点質量、線形拘束 (Constraint) の専用モデル・glyph・プロパティ編集
- 2D 平面図 / 3D パース表示と、表示形状に対応した 2D screen-space / 3D Raycaster 選択
- 凹多角形の三角形分割、screen-space 太線、透明面の描画順制御
- stable ID、表示、ロック、隔離、複製、上下階コピーを備えたレイヤー管理
- 節点・端点・中点・部材交点・グリッドへのスナップと、水平・鉛直・X/Y 軸・直交拘束
- スナップ候補切替、種別 glyph、X / Y / Z 座標入力、距離・角度入力
- 複数種別を組み合わせられる選択フィルタ、ラベル表示、選択要素の表示・非表示・隔離
- JSON schema version 2 での保存・読込と、version なしの legacy v0 / schema v1 からの自動移行
- 構造解析用 YAML の source / generated 読込と、元 ID・材料・断面・単位・警告などの provenance 永続化
- Command 経由のモデル変更、構造差分 Undo / Redo、未保存状態表示、破壊操作前の確認、世代付き IndexedDB draft 復旧
- 保存前モデル検証、複数エラー収集、対象選択と自動ズーム
- Pointer Events によるパン・ズーム・回転とレスポンシブな canvas resize
- 日本語 / English、ダーク / ライトテーマ、キーボード操作、アクセシブルなダイアログ
- アプリ内操作マニュアル

## 技術スタック

| 項目             | 技術                                      |
| ---------------- | ----------------------------------------- |
| 言語             | TypeScript                                |
| ビルド           | Vite                                      |
| 3D 描画          | Three.js (WebGL)                          |
| UI               | HTML + CSS                                |
| データ形式       | JSON（保存形式） / YAML（解析データ読込） |
| 単体・DOM テスト | Vitest / jsdom                            |
| ブラウザ E2E     | Playwright / Chromium                     |
| 静的解析・整形   | TypeScript / ESLint / Prettier            |
| カバレッジ       | Vitest v8 coverage                        |
| デプロイ         | GitHub Pages                              |

## セットアップ

Node.js `^20.19.0` または `>=22.13.0` が必要です。

```bash
npm install
npm run dev              # 開発サーバー
npm run build            # 型検査 + 本番ビルド
npm run preview          # ビルド結果プレビュー
```

品質確認用のスクリプトも用意しています。

```bash
npm run typecheck        # アプリの型検査
npm run typecheck:test   # テスト・E2Eを含む型検査
npm run lint             # ESLint
npm run format:check     # Prettier差分確認
npm test                 # 単体・DOMテスト
npm run test:coverage    # カバレッジと閾値確認
npm run test:e2e         # Chromium E2E・visual regression
npm run test:e2e:update  # visual baseline更新
npm run check:bundle     # JS chunk / 合計サイズbudget確認
npm run check            # format / 型検査 / lint / unit / coverage / build / bundle budget
```

Pull Request と `main` への push では CI が `npm run check`、high 以上の依存監査、Playwright E2E と screenshot 比較を実行します。GitHub Pages の deploy も同じ型検査・テスト・coverage・build・bundle budget・監査を通過した成果物だけを公開します。

## 操作方法

### ツール

| ツール     | 操作                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------- |
| 選択       | クリックで要素選択（Shift: 追加, Ctrl: 反転）、ドラッグで矩形選択、ダブルクリックでプロパティ表示 |
| 移動       | 選択した節点をクリックして移動。確定前に Esc またはツール切替すると元の位置へ戻る                 |
| 節点追加   | クリック位置に節点を追加                                                                          |
| 梁追加     | 2 点をクリックして梁を追加                                                                        |
| 柱追加     | クリック位置に柱を追加（現レイヤーから直上要素まで）                                              |
| 床追加     | 2 点クリックで矩形の床を追加                                                                      |
| 壁追加     | 2 点クリックで壁を追加                                                                            |
| 耐力壁追加 | 2 点クリックで耐力壁を追加                                                                        |

2 点作図の 1 点目は preview として保持され、ステータスバーへ「1 点目選択済み」と表示されます。2 点目の確定時に必要な節点と要素を 1 Command で追加します。新規作成、読込、削除、すべてのレイヤー変更、2D / 3D 切替、Esc、ツール切替では途中操作をキャンセルします。柱・壁の直上要素が見つからない場合など、確定できなかった理由もステータスバーへ表示します。

YAML / JSON から読み込んだ Truss、Spring、Support、Constraint は専用色と glyph で描画され、ダブルクリックで構造プロパティを編集できます。Node ダイアログでは 6 自由度質量も編集できます。

### スナップと数値入力

スナップが有効なときは、現在の作業平面上にある候補を CSS pixel 距離で判定し、節点・端点、部材中点、交点、作図拘束、グリッドの順で利用します。

- 作図拘束: 画面水平・鉛直、X 軸、Y 軸、選択部材への直交
- 候補切替: `Tab` または候補切替ボタン。安定 ID によりマウス移動後も同じ候補を追跡
- 一時無効化: `Alt` を押している間はオブジェクトスナップとグリッドスナップを無効化
- 座標入力: X / Y / Z に有限値を入力して `入力` または Enter
- 極座標入力: 2 点作図の 1 点目を基準に距離と角度（+X=0°、+Y=90°）を入力

選択中の候補は canvas 上の種別 glyph とステータスバーへ表示されます。同じ座標へ収束する拘束候補はまとめて扱われます。

### カメラ操作

| 操作 / ボタン      | 動作                              |
| ------------------ | --------------------------------- |
| 右ドラッグ         | 2D: パン / 3D: 回転               |
| 中央ドラッグ       | パン                              |
| ホイール           | ズーム                            |
| Home または F      | モデル全体を表示                  |
| 上面 / 正面 / 右面 | 各直交方向の標準ビュー            |
| アイソメ           | Z-up のアイソメトリック 3D ビュー |

### 選択、表示、ラベル

- 選択対象ポップオーバーで Node / Beam / Pillar / Truss / Spring / Support / Constraint / Floor / Wall / BearWall を複数選択できます。
- Node / Member / Plane 番号、section、床方向、荷重、階高、ローカル軸のラベルを個別に切り替えられます。
- 選択要素だけ表示、選択要素を非表示、選択要素を隔離、全表示を切り替えられます。
- 非表示またはロックされたレイヤーの要素は選択・編集対象になりません。

### レイヤー

| 操作                 | 機能                                                          |
| -------------------- | ------------------------------------------------------------- |
| レイヤー追加 / 削除  | 高さ重複を検証し、削除前に関連要素数と影響を確認              |
| 一覧をダブルクリック | 名前と高さを編集                                              |
| 表示 / ロック / 隔離 | レイヤー単位の表示、編集保護、単独表示                        |
| レイヤー複製         | stable ID を新規採番してレイヤーを複製                        |
| 上階 / 下階へコピー  | source レイヤー内の登録済み全要素を節点参照ごと隣接階へコピー |
| すべて表示           | レイヤー隔離を解除して全階を表示                              |
| レイヤー一覧の ↑ / ↓ | キーボードで前後のレイヤーへ移動                              |

各 Layer は名前や並び順に依存しない stable ID と `visible` / `locked` を持ち、schema v2 JSON に保存されます。

### その他のツールバー操作

| 操作                | 機能                                                     |
| ------------------- | -------------------------------------------------------- |
| 元に戻す / やり直す | Command で確定したモデル編集の Undo / Redo               |
| 検証                | 全不変条件エラーと作図上の警告を一覧表示                 |
| 読込情報            | YAML 読込時の元 ID、警告、材料、断面、構造要素件数を表示 |
| EN / JA             | 表示言語の切替（日本語 ⇔ English）                       |
| ☾ / ☀               | ダークモード / ライトモード切替                          |
| ?                   | 操作マニュアルの表示                                     |

言語とテーマの設定はブラウザに保存され、次回アクセス時にも維持されます。

### キーボードショートカット

| ショートカット                       | 機能                 |
| ------------------------------------ | -------------------- |
| Ctrl/Cmd + Z                         | 元に戻す             |
| Ctrl + Y または Ctrl/Cmd + Shift + Z | やり直す             |
| Ctrl/Cmd + S                         | 保存                 |
| Ctrl/Cmd + O                         | 開く                 |
| Tab（canvas focus 時）               | スナップ候補切替     |
| Esc                                  | 途中操作をキャンセル |
| Delete                               | 選択要素を削除       |
| Home または F                        | モデル全体を表示     |

## 変更管理、未保存状態、draft 復旧

- `AddElementsCommand`、`DeleteSelectionCommand`、`MoveNodesCommand`、`UpdatePropertiesCommand`、`UpdateLayersCommand`、`ImportCommand` でモデル変更経路を統一します。
- `Document.execute()` / transaction の確定時に検証、再採番、metadata 無効化、通知を一度だけ行います。
- Undo / Redo は portable JSON snapshot 全体ではなく、変更前後から生成した構造差分を最大 100 件保持します。
- 選択状態だけの変更は編集履歴や未保存判定に含めません。
- 保存済み状態との差があると、ブラウザタイトルとステータスのバージョン表示に `*` が付きます。
- 未保存状態で New / Open / ブラウザ終了を行う場合は確認します。Open と削除は失敗時に元状態へ戻す atomic 操作です。
- 未保存モデルは一定時間後に IndexedDB へタブごと最大 3 世代の draft として保存されます。次回起動時は旧セッションを含む最新の有効世代を提示し、最新世代が破損していても直前の有効世代へフォールバックします。復旧または破棄した系列は再提示されません。

## モデル検証

`検証` ボタン、JSON / YAML 読込、Document 更新、保存で同じ検証規則を使用します。保存を止めるエラーを一件で打ち切らず収集し、警告と合わせて一覧表示します。対象付きの項目は選択して自動ズームできます。

- 非有限値、不正・重複 ID、Document 外参照、自由度・単位・係数の不正
- 零長部材。ただし別 Node の同一座標を結ぶ専用 Spring だけは許可
- 退化・非平面・自己交差する面、壁・耐力壁の頂点数
- Truss の面積・弾性係数、Spring の成分・方向、Support / Constraint の参照整合性
- stable layer ID、レイヤー高さ重複、表示 / ロック flag
- 孤立節点、重複座標節点、重複部材、未設定 section
- レイヤー外節点、異なる高さを結ぶ梁、YAML provenance の stale 参照

## データ形式

保存形式は JSON schema version 2 です。`schemaVersion` がない legacy v0 と schema v1 は、検証後に v2 へ移行して読み込みます。未対応 version、不正な型、非有限値、重複 ID、欠落参照、退化形状は既存 Document を置換する前に拒否します。

```json
{
  "schemaVersion": 2,
  "nodes": [
    {
      "number": 0,
      "pos": { "x": 0, "y": 0, "z": 0 },
      "mass": {
        "values": [1, 1, 1, 0, 0, 0],
        "translationalUnit": "N*s^2/mm",
        "rotationalUnit": "N*mm*s^2"
      }
    },
    { "number": 1, "pos": { "x": 6000, "y": 0, "z": 0 } }
  ],
  "beams": [{ "number": 0, "nodeI": 0, "nodeJ": 1, "section": "G1" }],
  "pillars": [],
  "trusses": [],
  "springs": [],
  "floors": [],
  "walls": [],
  "bearWalls": [],
  "supports": [{ "number": 0, "node": 0, "fixedDofs": ["ux", "uy", "uz"] }],
  "constraints": [],
  "layers": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "1F",
      "posZ": 0,
      "visible": true,
      "locked": false
    }
  ]
}
```

data 層の `TYPE_REGISTRY` を型の順序、constructor、採番 category の単一ソースとし、`DocumentDataCodecRegistry` が各型の JSON collection、検証、serialize / deserialize、レイヤーコピー時の clone を結び付けます。全 core 型と codec の 1 対 1 対応は起動時とテストで検査されます。未登録型は保存時にエラーとなり、既知 collection だけが黙って欠落することはありません。レイヤーの未知 optional field は migration / round-trip で保持します。

`select` などの一時 UI 状態はモデル JSON には保存しません。YAML から読み込んだモデルでは、次の情報を optional な `importMetadata` として同じ JSON に保存します。

- 読込形式・モード・モデル名・単位・警告・型別件数
- 元節点 ID / 元部材 ID と現在の Node / Member / Plane / Constraint 番号の対応
- 元要素型、section、material、要素 tag、元節点 ID、変換注記
- 材料特性と断面特性

`importMetadata` 内の参照は `category + number` で保持し、モデル件数・参照・summary の整合性を読込前と保存前に検証します。

### 座標系

- X 軸: 右方向
- Y 軸: 奥行き方向
- Z 軸: 高さ方向（上）
- 単位: mm

### 構造解析用 YAML の読込

`schema_version`, `units`, `model`, `traceability` を持つ構造解析用 YAML を読み込めます。

- 対応拡張子: `.yaml`, `.yml`
- 読み込み後の保存形式: schema version 2 の JSON
- 元 CAD 形状: `traceability` を優先して解析メッシュではなく元 CAD 形状に近い Node / Member / Plane を復元し、source `hbrace` は生成要素の面積・弾性係数・材料を持つ Truss として保持
- 生成済み解析要素: `elasticTimoshenkoBeam3D` を Beam、`truss3D` を Truss、`twoNodeLink3D` を Spring として保持
- 生成済み解析情報: 6 自由度節点質量、Support、equalDOF / 線形 Constraint を専用型として保持
- provenance: 元 ID、element tag / type、section、material、材料・断面特性、単位、警告・注記を永続化

同じ座標でも異なる Node tag 間の `twoNodeLink3D` は正当な零長 Spring として保持し、同じ Node tag を両端に使う不正要素は拒否します。source mode で解析専用情報を CAD 形状へ反映しない場合は、読込情報の警告として明示します。

## アーキテクチャ

- `Document` はシングルトンで、`dataList` と Layer を一元管理します。
- データ追加・更新は検証後に自動ソートし、Node / Member / Plane / Constraint category ごとに番号を再割り当てします。
- Node 削除前に Member / Plane / Support / Constraint の参照を確認します。
- `Point3D` は `{ x, y, z }` 形式、構造自由度は `ux, uy, uz, rx, ry, rz` の安定名で保存します。
- `main.ts` からアプリ横断状態、ファイル、ツール、レイヤー、設定の責務を各 Controller へ分離しています。

```text
src/
├── main.ts                 # エントリポイントとController/UI結線
├── version.ts              # package.json由来のアプリversion
├── i18n.ts                 # 多言語・ARIA文言
├── commands/               # Document Command群
├── controllers/            # App / File / Tool / Layer / Settings
├── data/                   # Document、モデル型、Layer、Validator/Inspector
├── display/                # 表示filterとlabel設定
├── history/                # 構造差分Undo/Redoと世代付きIndexedDB draft
├── math/                   # Point3D、Point2D、距離・角度入力
├── io/                     # schema v2、codec registry、metadata、YAML入出力
├── selection/              # 複数種別選択フィルタ
├── ui/                     # CadView、Camera、Renderer、Input、ObjectSnap
│   ├── handlers/           # マウスハンドラ
│   └── dialogs/            # プロパティ、検証、読込情報、ヘルプ
└── styles/                 # CSS

tests/                      # Vitest単体・DOMテスト
e2e/                        # Playwright smoke / visual regression
scripts/                    # bundle size budget
```

## 品質基準

- Vitest: 31 ファイル・287 テスト
- coverage 閾値: statements / functions / lines 75%、branches 60%（実測 77.03% / 78.21% / 79.72% / 66.26%）
- Playwright: sample 読込、dirty New / Open、Undo / Redo、2D / 3D 選択、操作状態・選択数同期、resize / theme、WebGL screenshot の 8 テスト
- bundle budget: 1 chunk 525 KiB 以下、JavaScript 合計 850 KiB 以下
- 現在の本番 build: app 249.23 kB + 97.39 kB、Three.js 506.59 kB（合計 853,214 bytes）
- app version は `package.json` を単一ソースとし、Vite が画面表示と HTML title へ注入

全レビュー項目の実装根拠は [CODE_REVIEW_AND_ROADMAP.md](CODE_REVIEW_AND_ROADMAP.md) を参照してください。

## アクセシビリティ

- toolbar / group、canvas、layer listbox、dialog の role と accessible name を設定しています。
- ダイアログは label と control を関連付け、初期 focus、Tab trap、Enter 確定、Esc、focus 復帰、inline 数値エラーに対応します。
- 言語切替時は表示テキスト、ARIA label、`<html lang>` を同期します。
- `:focus-visible`、高コントラスト、狭幅表示、coarse pointer 向け 44px 操作対象を用意しています。

## サンプルデータ

`sample-data/` ディレクトリにサンプルファイルが含まれています。

| ファイル             | 内容                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pillar_test.json`   | 小規模モデル（19 節点, 3 梁, 9 柱, 2 層）                                                                                   |
| `test.json`          | 大規模モデル（88 節点, 32 梁, 37 柱, 壁/床あり, 3 層）                                                                      |
| `Test0202_calc.yaml` | 構造解析用 YAML 読込テスト（元 CAD 形状: 10 節点, 4 梁, 2 トラス, 4 床, 1 層 / 生成済み解析要素: 専用構造型を含む 76 節点） |

## ライセンス

All rights reserved.
