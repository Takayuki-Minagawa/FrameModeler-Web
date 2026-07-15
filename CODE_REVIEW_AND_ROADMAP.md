# FrameModeler-Web コードレビュー・実装結果ロードマップ

- レビュー日: 2026-07-14
- 実装反映日: 2026-07-14
- PRレビュー反映日: 2026-07-15
- 対象: `src/`、`tests/`、`index.html`、Vite/TypeScript/Vitest設定、GitHub Pages workflow
- 前提: `Document` のシングルトン、X=右・Y=奥・Z=上、mm単位、静的ホスティングという既存方針は維持する

## 実装サマリー

この文書は、最初のコードレビューで挙げた提案と、このブランチでの実装結果を同じ ID で追跡する。既存の `Document` シングルトン、Z-up、mm 単位、静的ホスティングを維持したまま、P1、P2、P3 と F1〜F6 の全項目を実装した。以下の表を現在の実装状態の正とし、後半の「レビュー詳細」は着手前の問題と判断根拠を残した履歴として扱う。

### 完了項目

| ID        | 実装結果                                                                                                                       | 主な実装・テスト                                                                                                                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1      | 2 点作図の 1 点目を preview に限定し、New / Open / Delete / 全 Layer mutation / view / Esc / tool 切替で破棄                   | [TwoClickAddHandler.ts](src/ui/handlers/TwoClickAddHandler.ts)、[LayerController.ts](src/controllers/LayerController.ts)、[HandlerTransactions.test.ts](tests/HandlerTransactions.test.ts)、[LayerManagement.test.ts](tests/LayerManagement.test.ts)                                                                                                |
| P1-2      | 有限値、ID、参照、退化形状、構造自由度、stable layer ID を Document 境界で検証し、複数違反の収集にも対応                       | [ModelValidator.ts](src/data/ModelValidator.ts)、[Document.ts](src/data/Document.ts)、[Document.test.ts](tests/Document.test.ts)、[ModelInspector.test.ts](tests/ModelInspector.test.ts)                                                                                                                                                            |
| P1-3      | 3D は実 geometry の Raycaster、2D は CSS pixel 基準の専用 hit test とし、平行・後方作業面を拒否                                | [CadView.ts](src/ui/CadView.ts)、[CadRenderer.ts](src/ui/CadRenderer.ts)、[CameraController.ts](src/ui/CameraController.ts)、[CadRenderer.test.ts](tests/CadRenderer.test.ts)、[CameraController.test.ts](tests/CameraController.test.ts)                                                                                                           |
| P1-4 / F1 | 個別 Command、transaction、構造差分 Undo / Redo、dirty / saved revision、3 世代 IndexedDB draft を実装                         | [DocumentCommands.ts](src/commands/DocumentCommands.ts)、[DocumentHistory.ts](src/history/DocumentHistory.ts)、[SnapshotDelta.ts](src/history/SnapshotDelta.ts)、[DraftStore.ts](src/history/DraftStore.ts)、[DocumentCommands.test.ts](tests/DocumentCommands.test.ts)、[DraftStore.test.ts](tests/DraftStore.test.ts)                             |
| P1-5      | dirty New / Open / beforeunload、事前 build + 単一 ImportCommand、atomic delete、rollback、旧 session draft 復旧を実装         | [AppController.ts](src/controllers/AppController.ts)、[FileController.ts](src/controllers/FileController.ts)、[DocumentImportPlan.ts](src/io/DocumentImportPlan.ts)、[AppController.test.ts](tests/AppController.test.ts)、[ImportPlan.test.ts](tests/ImportPlan.test.ts)、[app.spec.ts](e2e/app.spec.ts)                                           |
| P1-6      | YAML の source ID / element tag 重複と optional 値の型不正を path 付きで拒否                                                   | [CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts)、[CalcYamlDeserializer.test.ts](tests/CalcYamlDeserializer.test.ts)                                                                                                                                                                                                                       |
| P1-7      | Pointer Events の全 click を作図へ渡し、native `dblclick` を選択 tool に限定                                                   | [InputController.ts](src/ui/InputController.ts)、[SelectionHandler.ts](src/ui/handlers/SelectionHandler.ts)、[InputController.test.ts](tests/InputController.test.ts)                                                                                                                                                                               |
| P1-8      | CI / Pages にformat、型検査、lint、unit、coverage、build、bundle budget、audit を、CI に Playwright を設定                     | [package.json](package.json)、[ci.yml](.github/workflows/ci.yml)、[deploy.yml](.github/workflows/deploy.yml)、[dependabot.yml](.github/dependabot.yml)                                                                                                                                                                                              |
| P2-1      | camera / grid / elements / selection / preview の dirty flag、要素 batch、動的 preview buffer を実装                           | [CadView.ts](src/ui/CadView.ts)、[CadRenderer.ts](src/ui/CadRenderer.ts)                                                                                                                                                                                                                                                                            |
| P2-2      | 可視範囲に揃う 1/2/5/10 grid、Box3 fit、ResizeObserver、DPR 上限、camera 基底 pan、標準 view を実装                            | [CadRenderer.ts](src/ui/CadRenderer.ts)、[CameraController.ts](src/ui/CameraController.ts)、[CameraController.test.ts](tests/CameraController.test.ts)                                                                                                                                                                                              |
| P2-3      | pointer capture / cancel / lost、CSS pixel drag 判定、冪等 dispose を実装                                                      | [InputController.ts](src/ui/InputController.ts)、[CadView.ts](src/ui/CadView.ts)、[InputController.test.ts](tests/InputController.test.ts)                                                                                                                                                                                                          |
| P2-4      | Layer を data 層へ移動し、型 metadata の単一 registry + 全型 codec、UI formatter、Controller 分割を実装                        | [typeRegistry.ts](src/data/typeRegistry.ts)、[DocumentDataCodecRegistry.ts](src/io/DocumentDataCodecRegistry.ts)、[LayerController.ts](src/controllers/LayerController.ts)、[controllers](src/controllers)、[StructuralDataIo.test.ts](tests/StructuralDataIo.test.ts)                                                                              |
| P2-5      | `schemaVersion: 2`、legacy v0 / v1 migration、parse / validate / migrate / domain build、意味的 round-trip を実装              | [JsonSchema.ts](src/io/JsonSchema.ts)、[JsonDeserializer.ts](src/io/JsonDeserializer.ts)、[JsonSerializer.ts](src/io/JsonSerializer.ts)、[JsonRoundtrip.test.ts](tests/JsonRoundtrip.test.ts)、[StructuralDataIo.test.ts](tests/StructuralDataIo.test.ts)                                                                                           |
| P2-6      | dialog ARIA、label 関連付け、focus 管理、Enter / Esc、inline 数値検証、canvas / listbox、lang 同期、responsive CSS を実装      | [DialogUtil.ts](src/ui/dialogs/DialogUtil.ts)、[i18n.ts](src/i18n.ts)、[index.html](index.html)、[DialogAccessibility.test.ts](tests/DialogAccessibility.test.ts)                                                                                                                                                                                   |
| P2-7      | test 型検査、coverage 閾値、Playwright Chromium smoke、WebGL screenshot visual regression を実装                               | [vitest.config.ts](vitest.config.ts)、[playwright.config.ts](playwright.config.ts)、[app.spec.ts](e2e/app.spec.ts)、[webgl-full-model.png](e2e/app.spec.ts-snapshots/webgl-full-model.png)                                                                                                                                                          |
| F2        | 保存前検証 panel、複数 Error / Warning、対象選択、自動 zoom、provenance 整合性確認を実装                                       | [ModelInspector.ts](src/data/ModelInspector.ts)、[ModelValidationDialog.ts](src/ui/dialogs/ModelValidationDialog.ts)、[ModelInspector.test.ts](tests/ModelInspector.test.ts)                                                                                                                                                                        |
| F3        | 節点・端点・中点・交点・grid、水平 / 鉛直 / X/Y 軸 / 直交拘束、安定候補 ID と切替、glyph、Alt、座標・距離・角度入力を実装      | [ObjectSnapEngine.ts](src/ui/ObjectSnapEngine.ts)、[PlanInput.ts](src/math/PlanInput.ts)、[ObjectSnapEngine.test.ts](tests/ObjectSnapEngine.test.ts)、[CadViewObjectSnap.test.ts](tests/CadViewObjectSnap.test.ts)、[PlanInput.test.ts](tests/PlanInput.test.ts)                                                                                    |
| F4        | Layer の stable ID、visible / locked / isolate、編集、複製、上下階コピー、削除影響確認を実装                                   | [Layer.ts](src/data/Layer.ts)、[LayerCopy.ts](src/data/LayerCopy.ts)、[LayerController.ts](src/controllers/LayerController.ts)、[LayerManagement.test.ts](tests/LayerManagement.test.ts)                                                                                                                                                            |
| F5        | Truss / Spring / Support / Constraint / 6 自由度 Node mass と source hbrace の専用型、永続化、glyph、選択、編集を実装          | [Truss.ts](src/data/Truss.ts)、[Spring.ts](src/data/Spring.ts)、[Support.ts](src/data/Support.ts)、[Constraint.ts](src/data/Constraint.ts)、[StructuralDataIo.test.ts](tests/StructuralDataIo.test.ts)、[CalcYamlDeserializer.test.ts](tests/CalcYamlDeserializer.test.ts)                                                                          |
| F6        | 複数種別 filter、label、表示 / 非表示 / 隔離、標準 view、選択数・1 点目・失敗理由の状態表示を実装                              | [SelectionFilter.ts](src/selection/SelectionFilter.ts)、[DisplayFilter.ts](src/display/DisplayFilter.ts)、[DisplayLabels.ts](src/display/DisplayLabels.ts)、[CadView.ts](src/ui/CadView.ts)、[HandlerTransactions.test.ts](tests/HandlerTransactions.test.ts)、[DisplayFilter.test.ts](tests/DisplayFilter.test.ts)、[app.spec.ts](e2e/app.spec.ts) |
| P3        | 凹多角形 triangulation、`LineSegments2` 太線、透明面 order、version 単一ソース、Three.js chunk 分離、bundle size budget を実装 | [CadRenderer.ts](src/ui/CadRenderer.ts)、[version.ts](src/version.ts)、[vite.config.ts](vite.config.ts)、[check-bundle-size.mjs](scripts/check-bundle-size.mjs)、[CadRenderer.test.ts](tests/CadRenderer.test.ts)                                                                                                                                   |

## 検証結果

以下は 2026-07-15 のPRレビュー反映後の検証基準と実測である。

| 確認項目                | 結果 | 補足                                                                                                               |
| ----------------------- | ---: | ------------------------------------------------------------------------------------------------------------------ |
| `npm run check`         | 成功 | Prettier、app / test 型検査、ESLint、Vitest、coverage、Vite build、bundle budget                                   |
| `npm run test:coverage` | 成功 | 33 ファイル・300 テスト                                                                                            |
| `npm run test:e2e`      | 成功 | Chromium で sample 読込、dirty New / Open、Undo / Redo、2D / 3D 選択、状態同期、resize / theme、visual の 8 テスト |
| coverage threshold      | 成功 | 閾値 statements / functions / lines 75%、branches 60%。実測 77.85% / 78.88% / 80.61% / 66.83%                      |
| `npm run format:check`  | 成功 | 対象ファイルはすべて Prettier 準拠                                                                                 |
| `npm audit`             | 成功 | high 以上の既知脆弱性 0 件                                                                                         |
| bundle budget           | 成功 | 3 chunks、JavaScript 合計 856,691 bytes。上限は 1 chunk 525 KiB / 合計 850 KiB                                     |

本番 build は app chunk 252.71 kB / 97.39 kB と Three.js chunk 506.59 kB に分離した。app version は `package.json` を単一ソースとし、Vite がランタイム表示と HTML title に注入する。

## PRレビュー追補（2026-07-15）

PR #6 に投稿されたレビュー本文の実行可能な13項目をすべて反映した。インラインレビュー・スレッドはなく、以下を回帰テストと品質ゲートへ追加した。

|   # | 指摘                                         | 対応結果                                                                                                                              | 主な実装・テスト                                                                                                                                                                                                             |
| --: | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | 外部tableのprototype汚染                     | JSON / YAML のunits・materials・sectionsをnull-prototype辞書で構築し、`__proto__` / `constructor` / `prototype`を通常データとして隔離 | [JsonSchema.ts](src/io/JsonSchema.ts)、[CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts)、[JsonValidation.test.ts](tests/JsonValidation.test.ts)、[CalcYamlDeserializer.test.ts](tests/CalcYamlDeserializer.test.ts) |
|   2 | locked layerをdomain APIから改名・移動できる | `Document.updateLayer`で改名・高さ変更を拒否し、表示変更と明示的なlock解除だけを許可                                                  | [Document.ts](src/data/Document.ts)、[Document.test.ts](tests/Document.test.ts)                                                                                                                                              |
|   3 | Pages deployがE2E成功を待たない              | deployを`CI`の成功した`main` pushの`workflow_run`へ限定し、検証済みSHAをcheckout。手動deployにも全品質ゲートを適用                    | [ci.yml](.github/workflows/ci.yml)、[deploy.yml](.github/workflows/deploy.yml)                                                                                                                                               |
|   4 | 複製タブでdraft keyが競合する                | ページロードごとにwriter IDをローテーションし、同時保存でも別keyを使用                                                                | [DraftStore.ts](src/history/DraftStore.ts)、[DraftStore.test.ts](tests/DraftStore.test.ts)                                                                                                                                   |
|   5 | 履歴・検証・Snapのi18n漏れ                   | `history.*` / `snap.*`キーへ集約し、Undo / Redoと検証dialogをlocale変更へ即時追随。日本語検証文から英語Validator本文を分離            | [i18n.ts](src/i18n.ts)、[main.ts](src/main.ts)、[ModelInspector.ts](src/data/ModelInspector.ts)、[ModelValidationDialog.test.ts](tests/ModelValidationDialog.test.ts)                                                        |
|   6 | Layer dialogが表示・lock状態を落とす         | dialogと複製処理で`visible` / `locked`を保持し、内容コピー中だけtargetを一時unlock                                                    | [LayerDialog.ts](src/ui/dialogs/LayerDialog.ts)、[LayerController.ts](src/controllers/LayerController.ts)、[LayerDialog.test.ts](tests/LayerDialog.test.ts)、[LayerController.test.ts](tests/LayerController.test.ts)        |
|   7 | 放置draftが無期限に残る                      | 30日TTLと最大20系列のGCを追加し、現在系列と最新の有効draftを保護                                                                      | [DraftStore.ts](src/history/DraftStore.ts)、[DraftStore.test.ts](tests/DraftStore.test.ts)                                                                                                                                   |
|   8 | `removeMany`のNode参照検査が間接的           | 削除集合外に残る参照元を事前検査し、参照元との同時削除は許可                                                                          | [Document.ts](src/data/Document.ts)、[Document.test.ts](tests/Document.test.ts)                                                                                                                                              |
|   9 | tracked change例外rollbackが未テスト         | snapshot、filename、shown layer、history、UI refreshの復元を回帰テスト                                                                | [AppController.test.ts](tests/AppController.test.ts)                                                                                                                                                                         |
|  10 | 検証dialogが未テスト                         | 一覧、severity、対象選択、開いている間のJA / EN切替をテストし、close時に購読解除                                                      | [ModelValidationDialog.ts](src/ui/dialogs/ModelValidationDialog.ts)、[ModelValidationDialog.test.ts](tests/ModelValidationDialog.test.ts)                                                                                    |
|  11 | `check`がVitestを二重実行                    | `test:coverage`の1回へ統合                                                                                                            | [package.json](package.json)                                                                                                                                                                                                 |
|  12 | E2Eがdevelopment serverを検査                | `vite preview`で本番bundleを検査し、CIでは`npm run check`が生成した同じ`dist`を使用                                                   | [playwright.config.ts](playwright.config.ts)、[package.json](package.json)、[app.spec.ts](e2e/app.spec.ts)                                                                                                                   |
|  13 | 支点hit倍率がマジックナンバー                | `CAD.SUPPORT_HIT_TOLERANCE_FACTOR`へ集約し、境界内外をテスト                                                                          | [CadConfig.ts](src/ui/CadConfig.ts)、[CadRenderer.ts](src/ui/CadRenderer.ts)、[CadRenderer.test.ts](tests/CadRenderer.test.ts)                                                                                               |

## レビュー詳細

以下はレビュー時の問題、改善方針、必要テストを保存した記録である。すべて上の完了マトリクスへ反映済みであり、行番号リンクはレビュー時点の位置を示す。

### レビュー時点の良い点

- [Document.ts](src/data/Document.ts#L54-L101) で追加・削除時のソート、再採番、Node削除前の参照確認を一元化している。
- [JsonDeserializer.ts](src/io/JsonDeserializer.ts#L61-L143) は一時オブジェクトを構築してから `bulkLoad` するため、通常の入力エラーでは既存Documentを途中まで壊さない。
- [CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts#L38-L115) はYAMLライブラリを遅延読込し、変換警告と元ID対応を保持している。
- [CadView.ts](src/ui/CadView.ts#L241-L263) は `requestAnimationFrame` で描画要求を集約し、[CadRenderer.ts](src/ui/CadRenderer.ts#L52-L57) は再構築時にgeometry/materialを破棄している。
- math/data/ioには有効な単体テストがあり、JSONの往復安定性とYAML変換の主要経路を検証している。

## 優先度（レビュー時の記録）

- **P1**: データ破損、誤作図、作業消失、選択誤り、既知の高リスク依存に関係するため、次のリリース前に対応する。
- **P2**: 大規模モデルの性能、保守性、アクセシビリティ、品質基盤として次期開発で対応する。
- **P3**: P1/P2完了後に進める表示品質・配布最適化・利便性改善。

## P1: 早急に対応する項目（レビュー時の記録）

### P1-1. 途中操作のライフサイクルを一元化する

**確認した問題**

[TwoClickAddHandler.ts](src/ui/handlers/TwoClickAddHandler.ts#L17-L45) は1点目を `anchor` に保持し、[onDeactivate](src/ui/handlers/TwoClickAddHandler.ts#L60-L65) でだけ破棄する。ツール切替では [main.ts](src/main.ts#L128-L139) が `onDeactivate` を呼ぶが、以下では呼ばれない。

- 新規作成: [main.ts](src/main.ts#L155-L164)
- ファイル読込: [main.ts](src/main.ts#L166-L205)
- 選択要素削除: [main.ts](src/main.ts#L238-L263)
- レイヤー切替: [main.ts](src/main.ts#L312-L322)
- 2D/3D切替: [main.ts](src/main.ts#L294-L306)

梁の1点目をクリックしてから「新規」を実行し、続けて2点目をクリックすると、旧Documentから消えたNodeを参照するBeamを新Documentへ追加できる。[AddBeamHandler.ts](src/ui/handlers/AddBeamHandler.ts#L11-L24) は1点目でNodeを即時追加するため、ツールをキャンセルしただけでも孤立Nodeが残る。削除、読込、レイヤー切替でも同種の不整合や意図しない階跨ぎ部材を作り得る。

**改善案**

- `ToolSession.cancelCurrentOperation()` または全ハンドラ共通の `cancel()` を設ける。
- 新規、読込commit前、削除前、shownLayer変更前、2D/3D切替、Esc押下時に必ず呼ぶ。
- commit直前に、保持中Nodeが現在の `Document.allDataList` に所属することを検証する。
- 1点目では新規NodeをDocumentへ追加せず、座標または既存Node参照を仮保持し、2点目のtransaction内で必要なNodeと部材をまとめて追加する。

**必要テスト**

`1点目 → new/open/delete/layer change/3D切替 → 2点目` の各経路で、要素が追加されず参照グラフが有効なままであることを確認する。

### P1-2. モデル不変条件と数値検証をDocument境界へ集約する

**確認した問題**

- [JsonDeserializer.ts](src/io/JsonDeserializer.ts#L231-L233) は `NaN` だけを拒否するため、JSONの `1e400` を `Infinity` として受理する。保存時には `JSON.stringify` が非有限値を `null` に変換し、再読込不能になる。
- [AddBeamHandler.ts](src/ui/handlers/AddBeamHandler.ts#L15-L24) は同一Nodeを2回選んだ零長Beamを追加できる。
- [AddFloorHandler.ts](src/ui/handlers/AddFloorHandler.ts#L15-L27) は2点の完全一致しか拒否せず、X差またはY差が0の面積0のFloorを追加できる。
- [JsonDeserializer.ts](src/io/JsonDeserializer.ts#L12-L13) はWall/BearWallを2節点で受理する一方、[CadRenderer.ts](src/ui/CadRenderer.ts#L212-L245) は3節点未満を描画せず、耐力壁の筋交いは [CadRenderer.ts](src/ui/CadRenderer.ts#L247-L260) で4節点を必要とする。
- [Document.add](src/data/Document.ts#L54-L60) と [bulkLoad](src/data/Document.ts#L302-L317) はMember/Planeが参照するNodeのDocument所属、節点の一意性、要素の退化を検査しない。

**改善案**

`ModelValidator` とDocumentの生成・更新APIを設け、UI、JSON、YAML、保存前検証で同じ規則を使用する。

- 全数値: `Number.isFinite`
- ID/参照番号: 有限、整数、非負、一意
- Member: 両端NodeがDocument所属、異なるNode、長さが許容差より大きい
- Floor: 3点以上かつ一意、面積が許容差より大きい、平面、自己交差なし
- Wall/BearWall: 現行仕様を四角形とするなら4点必須。旧2点形式を扱うなら明示的migrationで上端点を補完
- Plane: 重複Node、非平面、自己交差、無効な節点順を検査
- `bulkLoad` は入力配列をコピーし、検証成功後だけ置換
- zero-length springはBeamの例外にせず、将来の専用Spring型だけで許可

**必要テスト**

Infinity、同一端点、面積0、重複頂点、2/3節点Wall、Document外参照、非平面、自己交差を拒否し、失敗後も読込前Documentが維持されることを確認する。

### P1-3. 3D選択と3D作業平面をRaycasterベースにする

**確認した問題**

[CadView.hitTest](src/ui/CadView.ts#L154-L181) は、Nodeだけ3D距離、MemberはXY線分距離、PlaneはXYポリゴン内判定を使用する。3D表示時は全階を候補にするが、カメラからの奥行き、遮蔽、画面上の前後関係を考慮しない。鉛直Wall/BearWallはXY投影が線に潰れるため、現行Plane判定ではほぼ選択できない。

[CameraController.screenToWorld](src/ui/CameraController.ts#L130-L146) は3Dでも現在レイヤー平面との交点を返すが、視線が平面と平行な場合は交点ではないunproject途中点を返し、交点がカメラ後方になる場合も許容する。

**改善案**

- 描画Object3DとDocumentDataの対応表をCadRendererに保持する。
- 3Dは `THREE.Raycaster.setFromCamera` で実geometryとの交点を求め、深度順の最前面を選ぶ。
- Node/Lineの許容幅はCSS pxを基準にし、深度に応じたworld幅へ変換する。
- 2DはNode、線材、床面、壁投影線ごとの専用判定を残し、すべてscreen-space許容幅へ統一する。
- 作業平面との交点は `Point3D | null` とし、平行または後方なら配置・移動を無効化して理由を表示する。

**必要テスト**

重なる階、遮蔽された要素、鉛直壁、透視投影の近景/遠景、平行視線、カメラ後方の作業面を対象にする。

### P1-4. すべての変更をCommand/transaction経由にする

**確認した問題**

- Node移動: [MoveNodeHandler.ts](src/ui/handlers/MoveNodeHandler.ts#L30-L45)
- Nodeプロパティ変更: [NodeDialog.ts](src/ui/dialogs/NodeDialog.ts#L27-L38)
- 部材・面プロパティ変更: [MemberDialog.ts](src/ui/dialogs/MemberDialog.ts#L32-L40)、[PlaneDialog.ts](src/ui/dialogs/PlaneDialog.ts#L62-L97)
- 床方向のダブルクリック変更: [AddFloorHandler.ts](src/ui/handlers/AddFloorHandler.ts#L35-L40)

これらはデータを直接変更するため、Documentのreindex、変更通知、import metadata無効化を一貫して通らない。Node座標はソートキーなので、移動後も番号と並びが古いままになる。レイヤー追加・削除も [Document.ts](src/data/Document.ts#L232-L255) では `onChanged` を発火せず、将来のdirty判定が変更を見落とす。

**改善案**

- `Document.execute(command)`、`transaction()`、`addMany/removeMany` を導入する。
- `MoveNodesCommand`、`UpdatePropertiesCommand`、`AddElementsCommand`、`DeleteSelectionCommand`、`UpdateLayersCommand`、`ImportCommand` を作る。
- transaction確定時に一度だけ `validate → reindex → metadata invalidate → notify` を実行する。
- ドラッグ中は表示用previewだけを変更し、確定時に1つのCommandとして履歴へ追加する。
- Documentは既存どおりシングルトンで公開し、内部の変更経路だけをCommandへ集約する。

このリファクタリングを、後述のUndo/Redo、dirty管理、autosaveの基盤にする。

### P1-5. 破壊操作と未保存変更を保護する

**確認した問題**

- 新規作成は変更有無に関係なく常に確認するが、Openは既存モデルを置換するのに確認しない: [main.ts](src/main.ts#L155-L205)
- 削除は失敗例外を握り潰し、部分的に削除されたことや残った理由を表示しない: [main.ts](src/main.ts#L238-L263)
- レイヤー削除に確認、使用中要素数、Undoがない: [main.ts](src/main.ts#L349-L356)
- `beforeunload`、dirty、Undo/Redo、draft復旧は未実装

**改善案**

- Command履歴のsaved revisionとの差でdirtyを判定する。
- dirty時だけNew/Open/ブラウザ終了前に確認する。
- Openは別の一時モデルへparse/validateし、ユーザー確認後にatomic commitする。
- 削除は事前に依存関係と削除順を計画し、全体を1 transactionにする。失敗対象と理由をまとめて表示し、未知例外は握り潰さない。
- localStorageではなく容量と世代管理に向くIndexedDBへdraftを定期保存し、起動時に復旧候補を提示する。

### P1-6. YAMLの一意性とoptional項目の型検査を厳密化する

**確認した問題**

- source modeの `source_node_id` は重複確認なしでMapを上書きする: [CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts#L366-L375)
- `source_member_id`、`source_surface_id` にも重複検査がない: [CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts#L387-L443)、[CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts#L446-L519)
- source modeの解析要素tagは重複時に後勝ちになる: [CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts#L629-L637)
- optional record/arrayの一部は、値が存在しても型不正なら空として扱う: [CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts#L687-L719)、[CalcYamlDeserializer.ts](src/io/CalcYamlDeserializer.ts#L730-L732)

重複IDにより、部材が意図しない節点へ接続されたり、material/sectionの由来が誤ったりする可能性がある。

**改善案**

- node/member/surface/elementごとにIDを事前収集し、重複時はpathとIDを示してimport全体を中止する。
- optional helperは「未指定」と「指定されたが型不正」を区別し、後者をエラーまたは明示警告にする。
- parserを純粋な `ImportPlan` 生成とDocumentへのcommitに分け、件数・警告・スキップ要素をcommit前に確認できるようにする。

### P1-7. ダブルクリック判定をツール別にする

**確認した問題**

[InputController.ts](src/ui/InputController.ts#L47-L83) は全ツール共通で2回目のmousedownを `handleClick` せず `handleDoubleClick` のみに送る。[TwoClickAddHandler.ts](src/ui/handlers/TwoClickAddHandler.ts#L48-L55) のダブルクリックは何もしないため、近接した2点を素早く選ぶと2点目が確定されない。床追加ツールでは、作図中のanchorを残したまま既存床の方向を変更する可能性もある。

**改善案**

- ダブルクリックを必要とする選択ツールだけにgesture policyを設定する。
- native `dblclick` または `event.detail` を使い、作図ツールでは全クリックをcommit候補として扱う。
- ツール切替とコンテキスト変更時にクリック履歴をリセットする。

### P1-8. 依存更新とCIをデプロイのゲートにする

**確認した問題**

[deploy.yml](.github/workflows/deploy.yml#L17-L33) は `npm ci` と `npm run build` だけで、98テストを実行せずmainをPagesへデプロイする。2026-07-14時点の `npm audit` はVite/Vitestを含む開発依存に8件を報告している。

**改善案**

- `npm audit fix --force` は使わず、Vite/Vitestの互換性確認を伴う依存更新PRに分ける。
- PR用CIで `npm ci → typecheck → lint → test → build → npm audit --audit-level=high` を実行する。
- Pages deployは上記check成功後だけ実行する。
- DependabotまたはRenovateで開発依存も定期更新する。

## P2: リファクタリング提案（レビュー時の記録）

### P2-1. 描画の無効化単位を分け、geometryをバッチ化する

[CadView.render](src/ui/CadView.ts#L241-L275) は常に `needsRebuild=true` にする。[TwoClickAddHandler.ts](src/ui/handlers/TwoClickAddHandler.ts#L50-L55) と [SelectionHandler.ts](src/ui/handlers/SelectionHandler.ts#L52-L70) はmousemoveごとに `render()` を呼ぶため、previewだけの変更でもgridと全要素を破棄・再生成する。

**改善案**

- dirty flagを `camera / grid / elements / selection / preview` に分ける。
- previewは既存BufferGeometryのattribute更新とRAF描画だけにする。
- Nodeは少数のPoints、梁・柱・braceは状態別LineSegments、柱記号はInstancedMeshまたはSpriteへまとめる。
- materialを色・透明度ごとに共有する。
- 大量追加・削除はDocument transactionでreindex/notifyを1回にする。

### P2-2. グリッド、カメラ、resizeを実表示領域に合わせる

**確認した問題**

- グリッドは常に `-range` 起点でglobal gridとずれ、camera-only panでは再構築されないため遠くへパンすると消える: [CadRenderer.ts](src/ui/CadRenderer.ts#L91-L114)、[CadView.ts](src/ui/CadView.ts#L215-L229)
- `fitToScene` は中心を移動するだけで、モデル範囲に合わせて距離を変えない: [CadView.ts](src/ui/CadView.ts#L116-L120)、[CameraController.ts](src/ui/CameraController.ts#L100-L104)
- resizeはwindowイベントだけで、ツールバー折返し、言語切替、パネル変更によるcanvas親サイズの変化を検知しない: [InputController.ts](src/ui/InputController.ts#L55-L60)
- devicePixelRatioを無制限に使用し、0サイズguardがない: [CadView.ts](src/ui/CadView.ts#L47-L66)、[CadView.ts](src/ui/CadView.ts#L101-L112)

**改善案**

- RenderContextへcameraCenterと可視範囲を渡し、grid開始点を `floor(min/gridWidth)*gridWidth` に合わせる。LOD幅は元gridWidthの1/2/5/10倍にする。
- Box3の中心・半径、aspect、FOVから2D/3DのcameraDistanceとnear/farを計算する。
- `ResizeObserver` でcanvas親を監視し、0サイズ時は描画を保留する。
- pixel ratioは設定可能にし、既定上限を2程度にする。
- 3D panはcamera right/up基底、2D panはworld-per-pixelで計算する。

### P2-3. 入力をPointer Eventsへ統一する

[InputController.ts](src/ui/InputController.ts#L51-L60) はmouseupをcanvasにしか登録しないため、canvas外でボタンを離すとdrag状態が残る。Listenerをbind/匿名関数で登録しているため、disposeもできない。

**改善案**

- `pointerdown/move/up/cancel` と `setPointerCapture` を使用する。
- `lostpointercapture` を含む全終了経路でdrag状態を解除する。
- 3〜5 CSS pxをclick/drag判定に使用し、[MIN_RECT_SIZE](src/ui/handlers/constants.ts#L1-L4) のworld単位依存をなくす。
- InputController/CadRenderer/CadViewへ冪等な `dispose()` を追加し、DOM listener、RAF、ResizeObserver、WebGLRenderer、scene resourceを解放する。

### P2-4. data/io/uiの依存方向と型登録を整理する

- data層がUI配下のLayerを参照している: [DocumentData.ts](src/data/DocumentData.ts#L1)、[Document.ts](src/data/Document.ts#L7)、[Layer.ts](src/ui/Layer.ts#L1-L27)
- 型順序・採番は [typeRegistry.ts](src/data/typeRegistry.ts#L23-L48)、保存は [JsonSerializer.ts](src/io/JsonSerializer.ts#L26-L67)、読込は [JsonDeserializer.ts](src/io/JsonDeserializer.ts#L93-L134) に別々に列挙されている。未知のDocumentDataは保存時にエラーにならず、JSONから消える。
- [main.ts](src/main.ts#L31-L392) がテーマ、ファイル、ツール、レイヤー、ステータスをすべて担当する。
- Documentとi18nの変更callbackは1件だけで、機能分割後に複数購読しにくい: [Document.ts](src/data/Document.ts#L20-L22)、[i18n.ts](src/i18n.ts#L167-L180)

**改善案**

- Layerを `src/data/Layer.ts` へ移し、表示用 `toString` はUI formatterへ分離する。
- JSON key、constructor、category、validate、serialize、deserializeを持つcodec registryへ統合し、未知型は保存前に必ずエラーにする。
- mainを `AppController / FileController / ToolController / LayerController / SettingsStore` に分ける。
- callbackを `subscribe/unsubscribe` 可能な型付きイベントへ変更する。モデル変更と表示状態変更は別イベントにする。

### P2-5. JSONをversioned schemaにする

現行JSONにはschema versionがなく、将来Wall形式や解析情報を拡張したときに互換性を判定できない。[JsonDocument](src/io/JsonDeserializer.ts#L50-L58) を独立したschema/codecへ移し、例えば `schemaVersion: 1` を追加する。

**方針**

- 現行形式をversionなしのlegacy v0として読めるようにする。
- `parse → validate → migrate → domain build` を分離する。
- selectionやカメラなど一時UI状態はモデル本体と分ける。
- 正規化したモデル全体の意味的round-tripをテストし、件数だけでなく参照、section、weight、direction、layersも比較する。

### P2-6. ダイアログと主要操作をアクセシブルにする

**確認した問題**

- dialogに `role="dialog"`、`aria-modal`、`aria-labelledby` がない: [DialogUtil.ts](src/ui/dialogs/DialogUtil.ts#L11-L19)
- labelとinput/selectが `for/id` で関連付けられていない: [DialogUtil.ts](src/ui/dialogs/DialogUtil.ts#L21-L69)
- 初期focus、Tab trap、focus復帰、Enter確定がない: [DialogUtil.ts](src/ui/dialogs/DialogUtil.ts#L104-L173)
- canvasはキーボードfocusとaccessible nameを持たず、レイヤーはclick専用のliである: [index.html](index.html#L52-L67)、[main.ts](src/main.ts#L312-L332)
- locale切替時に `<html lang>` を更新しない: [i18n.ts](src/i18n.ts#L167-L175)

**改善案**

- native `<dialog>` + `<form>`、または同等のARIA/focus管理へ共通化する。
- 数値エラーを0へ黙って置換せず、`Number.isFinite` とdomain制約をinline表示する。
- tool buttonに `aria-pressed`、layer listにlistbox/button semantics、canvasに `tabindex` と `aria-label` を付与する。
- `document.documentElement.lang` をlocaleと同期する。
- `:focus-visible`、200%ズーム、coarse pointer向け44px target、狭幅時のlayer drawerを追加する。

### P2-7. テスト境界をUI/Camera/Rendererまで広げる

[vitest.config.ts](vitest.config.ts#L3-L9) はnode環境でdata/io/mathを対象とし、[tsconfig.json](tsconfig.json#L18-L19) はtestsを型検査しない。

**改善案**

- `tsconfig.test.json` を追加し、テストコードも型検査する。
- fake InputHostでInputControllerとToolSessionの状態遷移を単体テストする。
- CameraControllerのray-plane、fit、Z-up、zoom clamp、px/world換算を単体テストする。
- DOMテストでdialog、i18n、focus、keyboard、layer操作を検証する。
- Playwright等でsample読込、2D/3D選択、New/Open保護、Undo/Redo、resize、テーマのsmoke testを行う。
- ESLint、formatter、coverage、統合 `npm run check` を追加する。

## P3: 追加の改善候補（レビュー時の記録）

- レイヤーなしDocumentでは全要素が低opacityになるため、`shownLayer === null` はactive扱いにする: [CadRenderer.ts](src/ui/CadRenderer.ts#L124-L169)
- 面のtriangle fanは凹多角形を正しく描けない。局所2Dへ投影してearcut等で三角形分割し、透明面の `depthWrite`、`renderOrder`、`polygonOffset` を整理する: [CadRenderer.ts](src/ui/CadRenderer.ts#L212-L245)
- WebGLの `LineBasicMaterial.linewidth` は実質1pxになる環境が多いため、Line2またはscreen-space quadを検討する: [CadRenderer.ts](src/ui/CadRenderer.ts#L183-L193)
- `APP_VERSION`、package version、HTML titleの重複を単一ソース化する: [version.ts](src/version.ts#L1)、[package.json](package.json#L1-L4)、[index.html](index.html#L1-L7)
- bundle visualizerとsize budgetを追加する。562.28 kB警告は直ちに動作不良ではないため、計測後にThree.js/vendor chunk分割や重い画面の遅延読込を判断する。
- [MemberDialog.ts](src/ui/dialogs/MemberDialog.ts#L9-L17) の `constructor.name` 判定や、[Member.ts](src/data/Member.ts#L33-L40) の範囲外index許容など、小さな型安全性の問題をcodec/command整理時に修正する。

## 有効な機能追加（レビュー時の記録）

### F1. Undo/Redo、dirty表示、draft復旧 — 最優先

Command/transaction化と同時に実装する。Add/Move/Edit/Delete/Layer/Importを履歴化し、移動中の多数のmousemoveは1操作へまとめる。

- Ctrl/Cmd+Z: Undo
- Ctrl+Y または Ctrl/Cmd+Shift+Z: Redo
- Ctrl/Cmd+S: 保存
- 未保存時はタイトルまたはステータスへ `*` を表示
- New/Open/beforeunloadはdirty時だけ確認
- IndexedDBに世代付きdraftを保存し、異常終了後に復旧

### F2. 保存前モデル検証パネル — 高

[main.ts](src/main.ts#L215-L219) は検証なしで即保存する。次をError/Warningとして一覧化し、項目クリックで対象を選択・全体表示する。

- orphan参照、Document外参照
- 零長・重複部材
- 重複座標Node、孤立Node
- 面積0、重複節点、非平面、自己交差Plane
- 未設定section、無効なweight/direction
- レイヤーに属さないNode、階跨ぎが疑わしい梁
- YAML provenanceと現在モデルの不一致

### F3. 構造CAD向けオブジェクトスナップと数値入力 — 高

現状の [CadView.snap](src/ui/CadView.ts#L122-L149) はXYグリッド丸めのみである。以下をscreen-space許容幅と優先順位つきで追加する。

- 既存Node、部材端点、中点、交点
- 直交、水平/鉛直、X/Y軸拘束
- スナップ種別glyphと候補切替
- Alt等による一時無効化
- 距離、角度、座標のキーボード入力

これにより、微小な節点ずれ、重複Node、柱梁芯の不一致を入力時に防げる。

### F4. レイヤー管理の強化 — 中

[LayerDialog.ts](src/ui/dialogs/LayerDialog.ts#L8-L29) は編集用引数を持つが、UIからは追加にしか使われていない。

- 名前・高さの編集と重複Z検証
- レイヤー複製、上階/下階への要素コピー
- visible / locked / isolate
- 削除前に使用中要素数と影響を表示
- stable IDを追加し、名前や並び変更に依存しない参照へ移行

### F5. 構造情報とYAML provenanceの永続化 — 中

READMEに記載された材料、断面性能、元ID、支点、質量、拘束、ばねの扱いを段階的に拡張する。

1. versioned JSONまたはsidecar JSONへmaterials、sections、source ID、source typeを保存する。
2. `truss3D`、`twoNodeLink3D`、hbraceをBeamへ潰さず、読み取り専用でも専用型・専用glyphとして保持する。
3. 支点、節点質量、拘束をまず表示・確認可能にし、その後編集へ広げる。

専用Spring型を導入すれば、解析上正当な零長ばねを通常の零長Beamと区別できる。

### F6. 要素情報表示と選択フィルタ — 中

- Node/Member/Plane番号、section、床方向、荷重、階高、ローカル軸の表示切替
- Node/梁/柱/床/壁/耐力壁ごとの選択フィルタ
- 選択要素だけ表示、非表示、隔離
- F/Homeで全体表示、上面/正面/側面/アイソメ標準ビュー
- Esc=途中操作キャンセル、Delete=削除、ツール切替ショートカット
- ステータスバーへ「1点目選択済み」「直上要素なし」などの操作状態と失敗理由を表示

## 当初の推奨実装順（履歴）

1. 現在の不具合を再現するテストを追加する。
2. `ModelValidator`、ToolSession cancel、有限値・退化形状・参照所属チェックを実装する。
3. Document transaction/Command、dirty、Undo/Redo、atomic delete/importを実装する。
4. CIへtest/typecheck/auditを追加し、Vite/Vitestを更新する。
5. 3D Raycaster、Pointer Events、render invalidation分離を実装する。
6. versioned JSONとcodec registryへ移行する。
7. 保存前検証、オブジェクトスナップ、レイヤー管理、構造情報永続化を追加する。

この順序を基準に、モデル不変条件、atomic 操作、Command / 構造差分履歴、CI、Raycaster / Pointer Events、schema v2 / codec registry、検証、作図支援、レイヤー、構造専用型、表示品質まで実装した。現在の実装根拠と検証結果は冒頭の完了マトリクスを正とする。
