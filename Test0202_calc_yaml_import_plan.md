# Test0202_calc.yaml 読み込み機能 追加計画

## 目的

`/Users/mina25/Desktop/Test0202_calc.yaml` のような構造解析用 YAML を FrameModeler-Web に読み込み、既存の CAD モデルとして表示・編集できる状態に変換する。

本計画ではコード修正は行わず、必要な対応範囲、設計方針、リスク、テスト観点を整理する。

## 追加確認された方針

現時点では、FrameModeler-Web の保存形式は既存 JSON のまま維持するのが妥当である。

理由:

- 既存アプリの正式な保存・再読込形式は JSON として動作している。
- 今回の YAML は解析プログラム向けの形式であり、CAD 編集用 JSON と目的が異なる。
- 保存形式まで同時に統一しようとすると、メタデータ、解析条件、材料・断面性能、既存 JSON 互換性をまとめて設計する必要があり、読み込み対応の範囲を超える。

一方で、将来的には複数プログラム間でデータ形式を統一するか、少なくとも相互変換仕様を整理する価値がある。その場合は、CAD モデル形式と解析モデル形式を分けた上で、共通 ID、節点、部材、材料、断面、荷重、境界条件の扱いを再設計する。

当面の優先事項は以下とする。

- YAML を読み込めること
- 部材形状を CAD 上で確認できること
- 節点番号を確認できること
  - アプリ内 `number`
  - YAML 側の `tag` / `source_node_id`
- 部材番号・元部材 ID を確認できること
  - アプリ内 `number`
  - YAML 側の `source_member_id` / 解析 element `tag`
- section と material を確認できること
- 材料特性・断面特性の数値を確認できること
- 保存は当面、既存 JSON のままとすること

## 調査体制

複数のサブエージェントで以下の観点を分担して確認した。

- YAML 形式・データ構造・既存 CAD モデルへのマッピング
- 既存 JSON 読み込み実装・Document 反映経路・実装箇所
- UX・依存関係・検証・テスト・受け入れ条件

メインエージェントでは、README の通読、既存コードの確認、対象 YAML の件数・要素種別・重複節点・traceability 情報を追加確認した。

## 対象 YAML の概要

対象ファイルは FrameModeler の保存 JSON ではなく、解析用に展開されたモデルである。

- トップレベル:
  - `schema_version`
  - `units`
  - `model`
  - `load_cases`
  - `load_combinations`
- `units.length` は `mm` で、既存アプリの座標単位と一致する。
- `model.nodes`: 76 件
- 全節点の Z 座標: `2800.0`
- 同一座標の別タグ節点: 8 組
- `supports`: 68 件
- `nodal_masses`: 64 件
- `constraints`: 72 件
- `groups`: 14 件
- `elements`: 79 件
  - `elasticTimoshenkoBeam3D`: 64 件
  - `truss3D`: 2 件
  - `twoNodeLink3D`: 13 件
- `materials`: `steel`, `alc`
- `sections`: `B`, `ALC_S_center_beam`
- `load_cases`, `load_combinations`: 空

重要なのは、`model.elements` が元 CAD の部材そのものではなく、分割梁・床パネル中心線梁・ばね要素を含む解析メッシュである点である。

## 既存実装の入口

現状の読み込みは JSON 専用である。

- README も保存・読み込み形式を JSON として説明している。
- [index.html](/Users/mina25/FrameModeler-Web/index.html:78) の file input は `accept=".json"` のみ。
- [src/main.ts](/Users/mina25/FrameModeler-Web/src/main.ts:159) で `FileReader` から `deserializeJson()` を直接呼ぶ。
- [src/io/JsonDeserializer.ts](/Users/mina25/FrameModeler-Web/src/io/JsonDeserializer.ts:61) は JSON を検証し、`Node` を先に作って参照解決した後、`Beam` / `Pillar` / `Floor` / `Wall` / `BearWall` / `Layer` を生成する。
- [src/data/Document.ts](/Users/mina25/FrameModeler-Web/src/data/Document.ts:278) の `bulkLoad()` が一括反映し、必ずソート・再採番・レイヤー重複排除を行う。
- [src/data/typeRegistry.ts](/Users/mina25/FrameModeler-Web/src/data/typeRegistry.ts:23) で型順と採番カテゴリが定義され、YAML の `tag` をアプリ内 `number` として固定保持する設計には向かない。

したがって、YAML importer も最後は `Document.bulkLoad()` に乗せるのが自然である。

## 推奨方針

初期実装は `traceability` を主入力にした CAD 形状優先モードとする。

理由:

- `model.elements` をそのまま読むと、元の 1 本の梁が複数の解析要素に分割され、CAD としては細切れになる。
- `twoNodeLink3D` はばね要素で、現行の `Node/Beam/Pillar/Floor/Wall/BearWall` に対応する型がない。
- `traceability.source_members` と `traceability.source_surfaces` には、元 JSON の部材・床面に近い情報が残っている。

MVP の期待変換結果:

- Nodes: 10 件
  - 外周 4 点と床パネル境界 x=`500,1000,1500` の上下点を座標で共有
- Beams: 6 件
  - `source_type: beam` 4 件
  - `source_type: hbrace` 2 件を暫定的に `Beam` として表示
- Pillars: 0 件
  - 対象 YAML は単一 Z 面で、鉛直柱に相当する要素がない
- Floors: 4 件
- Walls: 0 件
- BearWalls: 0 件
- Layers: 1 件
  - `traceability.source_level.level_id` と `z=2800.0` から生成

加えて、読み込み後に確認できる情報として以下を確保する。

- 節点:
  - アプリ内 node number
  - YAML の `tag` または `source_node_id`
  - 座標
- 部材:
  - アプリ内 member number
  - `source_member_id`
  - `source_type`
  - 接続節点
  - `section`
  - `material`
- 床:
  - アプリ内 plane number
  - `source_surface_id`
  - `section`
  - 矩形範囲
- 材料・断面:
  - `materials.steel`, `materials.alc`
  - `sections.B`, `sections.ALC_S_center_beam`
  - elastic modulus, shear modulus, area, inertia などの数値

## マッピング案

| YAML | FrameModeler-Web | 方針 |
| --- | --- | --- |
| `schema_version` | なし | 対応バージョン確認のみ |
| `units.length` | 座標単位 | MVP は `mm` のみ許可。その他は明示エラーまたは将来変換 |
| `model.name` | 読み込みサマリ | 永続化するなら将来メタデータ化 |
| `traceability.source_level` | `Layer` | `level_id` を name、`z` を `posZ` |
| `traceability.source_nodes[].coord` | `Node` | `source_node_id` は参照解決と表示用。`number` には固定しない |
| `traceability.source_members[type=beam]` | `Beam` | `source_section` を `section` に設定し、元 ID を確認可能にする |
| `traceability.source_members[type=hbrace]` | `Beam` | 専用型がないため線要素として表示し、brace 扱いを確認可能にする |
| `traceability.source_surfaces[type=floor].source_rect` | `Floor` | 矩形 4 隅を座標で生成・共有し、`section` と元 surface ID を確認可能にする |
| `model.elements.elasticTimoshenkoBeam3D` | 原則未使用 | raw 解析メッシュモードでのみ Beam 化を検討 |
| `model.elements.truss3D` | 原則未使用 | raw 解析メッシュモードでのみ Beam 化を検討 |
| `model.elements.twoNodeLink3D` | 非対応 | ばね要素として警告に出す |
| `supports` | 非対応 | 警告または将来メタデータ |
| `nodal_masses` | 非対応 | 警告または将来メタデータ |
| `constraints` | 非対応 | 警告または将来メタデータ |
| `materials`, `sections` | 読み込みサマリまたは参照ダイアログ | 現行モデルに保存先はないが、当面は確認できるよう保持する |
| `groups`, `result_extraction` | 非対応 | 将来メタデータ |

## 重要な設計判断

### tag と number

YAML の `tag` は解析モデルの安定 ID である。一方、FrameModeler-Web の `number` は `Document.bulkLoad()` 後に再採番される内部番号である。

対応:

- importer 内部では `source_node_id` / `node tag` / `source_member_id` から生成オブジェクトへの Map を持つ。
- `tag` を `number` として保存する設計にはしない。
- ただし確認用途として、元 `tag` / `source_node_id` / `source_member_id` を読み込み結果サマリまたはプロパティ表示に出す。
- `tag` を保存後の JSON でも永続化したい場合は、別途 `Document` メタデータまたは sidecar JSON の設計が必要。

### 重複節点

対象 YAML には同一座標で別 tag の節点が存在する。これは解析上、拘束やばね接続を表現するために意図的に分けられている。

対応:

- CAD 形状優先モードでは `traceability` と座標から CAD 節点を再構築し、同一座標は共有する。
- raw 解析メッシュモードを将来追加する場合は、同一座標節点を勝手に統合しない。
- 座標共有の tolerance は既存の `Document.getNodeAt()` の既定 `0.5mm` と整合させるか、importer 専用に明示値を定義する。

### レイヤー

対象 YAML は全節点が `z=2800.0` の単一層である。

対応:

- `traceability.source_level` があればそれを優先。
- ない場合は `model.nodes` の unique Z から推定する。
- 近接 Z が複数ある場合は tolerance 付きで警告する。

### 非対応情報の扱い

支点、質量、拘束、ばね、材料断面性能、解析結果抽出設定は現行 CAD モデルに保存先がない。

対応:

- 黙って破棄しない。
- 読み込みサマリに「未対応として読み飛ばした項目」と件数を表示する。
- 材料・断面性能は、保存対象ではなくても読み込み後の確認対象として保持・表示する。
- 将来、解析情報を保存・再利用したい場合は JSON スキーマ拡張か sidecar 方式を検討する。

## 実装計画

### Phase 1: 仕様固定

- 取り込みモードを `traceability` 優先 CAD 形状モードとして固定する。
- MVP の期待件数を固定する。
  - Nodes 10
  - Beams 6
  - Floors 4
  - Layers 1
- `hbrace` を `Beam` として表示することを仕様に明記する。
- `supports` / `nodal_masses` / `constraints` / `twoNodeLink3D` は警告扱いとする。
- 元節点番号、元部材 ID、section、material、材料・断面特性は確認対象に含める。
- 保存形式は現行 JSON のままとし、YAML 形式への保存や統一形式の設計は別フェーズに切り出す。
- `units.length !== "mm"` の扱いを決める。MVP はエラー推奨。

### Phase 2: YAML パーサ導入

対象ファイル:

- `package.json`
- `package-lock.json`

対応:

- runtime dependency として `yaml` パッケージを追加する。
- 通常の JSON 読み込み時に bundle を増やしすぎないよう、YAML 読み込み分岐で `dynamic import()` する。
- Node 専用 API に依存しないことを build で確認する。

### Phase 3: importer 追加

対象ファイル:

- `src/io/CalcYamlDeserializer.ts` または `src/io/CalcYamlImporter.ts`

対応:

- YAML parse
- スキーマ検証
- `traceability` から CAD 用 `DocumentData[]` と `Layer[]` を生成
- 参照不整合を検出
- warnings を収集
- 全変換成功後に `Document.instance.bulkLoad(data, layers)` を呼ぶ

推奨 API:

```ts
interface ImportWarning {
  code: string;
  message: string;
  path?: string;
}

interface ImportSummary {
  nodes: number;
  beams: number;
  pillars: number;
  floors: number;
  walls: number;
  bearWalls: number;
  layers: number;
  warnings: ImportWarning[];
  sourceIdMap: unknown;
  materials: unknown;
  sections: unknown;
}

async function deserializeCalcYaml(yamlString: string): Promise<ImportSummary>;
```

### Phase 4: UI 接続

対象ファイル:

- `index.html`
- `src/main.ts`
- `src/i18n.ts`

対応:

- file input の accept を `.json,.yaml,.yml` に広げる。
- 拡張子で JSON/YAML を分岐する。
- 拡張子がない場合は、先頭文字 `{` / `[` なら JSON、それ以外は YAML と推定する案を検討する。
- 読み込み成功後は既存と同じく filename 設定、レイヤー更新、`fitToScene()`、再描画、ステータス更新を行う。
- YAML 読み込み後の保存は当面 JSON とする。
- warnings がある場合は、alert ではなく読み込みサマリのモーダルまたはダイアログ表示を検討する。
- 読み込みサマリには以下を表示する。
  - 作成された Node / Beam / Floor / Layer 件数
  - 元 YAML の節点 tag / source id とアプリ内 number の対応
  - 元部材 ID とアプリ内 member number の対応
  - `hbrace` を `Beam` 表示した件数
  - material 一覧
  - section 一覧
  - 未対応項目と件数
- 既存のプロパティダイアログは接続 Node のアプリ内番号と座標、section までは確認できる。YAML 側の tag や材料特性も確認するには、サマリ画面または読み取り専用の import info ダイアログを追加する。
- i18n に以下を追加する。
  - 未対応ファイル形式
  - YAML parse error
  - YAML import warning
  - YAML import summary
  - material / section details

### Phase 5: テスト追加

対象ファイル:

- `tests/CalcYamlDeserializer.test.ts`
- 必要に応じて `sample-data/Test0202_calc.yaml`

テスト観点:

- `Test0202_calc.yaml` fixture を読み込むと期待件数になる。
  - Nodes 10
  - Beams 6
  - Floors 4
  - Layers 1
- `source_type: beam` の `section` が `B` になる。
- `source_type: hbrace` が `Beam` として作成され、`section` が `V` になる。
- floor の `section` が `S` になる。
- YAML 側の節点 ID とアプリ内 node number の対応表が生成される。
- YAML 側の部材 ID とアプリ内 member number の対応表が生成される。
- `materials` と `sections` の数値が `ImportSummary` で確認できる。
- `supports` / `nodal_masses` / `constraints` / `twoNodeLink3D` の warnings が返る。
- 存在しない node 参照は import 失敗する。
- `units.length` が `mm` 以外なら import 失敗する。
- parse error で既存 `Document` が変更されない。
- 既存 JSON テストがすべて維持される。

回帰確認:

- `npm test`
- `npm run build`
- 既存 `sample-data/pillar_test.json`
- 既存 `sample-data/test.json`

### Phase 6: ドキュメント更新

対象ファイル:

- `README.md`
- 必要に応じてヘルプダイアログ文言

対応:

- JSON が正式保存形式であることは維持する。
- YAML は「解析用 YAML から CAD 形状への変換読み込み」と説明する。
- 非対応情報があることを明記する。
- 読み込み後に確認できる情報と、保存後に保持されない情報を分けて明記する。
- YAML 読み込み後の保存は JSON になることを明記する。
- 将来的な統一形式検討は別フェーズで扱うことを明記する。

## エラーと警告の分類

Hard error:

- YAML として parse できない
- トップレベルまたは `model` が object でない
- `schema_version` が未対応
- `units.length` が `mm` でない
- `traceability` がなく、代替変換にも必要情報が不足している
- source node / member / floor の参照先が存在しない
- 座標値が number でない、または finite でない
- Floor の矩形が不正

Warning:

- `supports` を読み飛ばした
- `nodal_masses` を読み飛ばした
- `constraints` を読み飛ばした
- `twoNodeLink3D` を読み飛ばした
- `materials` / `sections` の数値性能を保存しなかった
- ただし読み込みサマリでは `materials` / `sections` の数値性能を確認可能にした
- `hbrace` を専用ブレースではなく `Beam` として取り込んだ
- raw 解析要素ではなく traceability から CAD 形状を復元した

## 将来拡張

### raw 解析メッシュ読み込みモード

`model.nodes` 全 76 件と `elasticTimoshenkoBeam3D` / `truss3D` 66 件を線要素として表示するモードを追加できる。ただし、ばね要素と拘束を表現できないため、CAD 編集用途とは別モードとして扱うべきである。

### メタデータ保持

解析情報を再保存・再利用する場合は、以下のいずれかが必要になる。

- `Document` に import metadata を追加し、JSON serializer/deserializer を拡張する。
- CAD JSON とは別に sidecar metadata JSON を保存する。
- CAD 用モデル形式と解析用モデル形式を別スキーマとして定義し、共通 ID で相互参照する。

保持候補:

- 元 YAML の `schema_version`, `units`
- `model.name`, `source_json`, `source_properties`, `analysis_profile`
- source id / tag とアプリ内 object の対応表
- `traceability`
- `groups`
- `supports`
- `nodal_masses`
- `constraints`
- `materials`
- `sections`

### 専用要素型

将来、水平ブレース、ばね、支点、質量、拘束を CAD 上で扱うなら、現行の `Beam/Pillar/Floor/Wall/BearWall` 以外のデータ型と描画・編集 UI が必要になる。

## 受け入れ条件

- `Test0202_calc.yaml` が YAML として読み込める。
- CAD 形状優先モードで Nodes 10、Beams 6、Floors 4、Layers 1 が生成される。
- 読み込み結果が `Document.bulkLoad()` 経由で反映され、既存のソート・再採番ルールに従う。
- YAML の `tag` をアプリ内 `number` として固定しない。
- YAML の `tag` / `source_node_id` / `source_member_id` とアプリ内番号の対応を確認できる。
- material / section の名称と数値特性を確認できる。
- 未対応情報は warnings としてユーザーに提示され、黙って破棄されない。
- parse error や変換 error 時に既存 Document が変更されない。
- 既存 JSON 読み込み・保存の挙動が変わらない。
- YAML 読み込み後の保存は既存 JSON のままである。
- `npm test` と `npm run build` が成功する。
- GitHub Pages の静的ホスティングで動作する。

## 結論

最初に実装すべきは、解析メッシュ全体の完全再現ではなく、`traceability` を使った CAD 形状復元である。これにより、対象 YAML から元の床面・梁・水平ブレースを既存の FrameModeler-Web データモデルに無理なく取り込める。

一方で、支点・質量・拘束・ばね・材料断面性能は現行モデルに保存先がないため、MVP では warnings として明示し、必要になった段階でメタデータ保持または専用要素型を追加するのが安全である。
