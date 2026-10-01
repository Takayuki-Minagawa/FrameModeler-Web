# 作業計画（2026-10-01）

このファイルは本ブランチの作業中だけ使う一時的な計画書で、マージ前に削除する。

## 1. レビュー結果

### リファクタリングが必要な点

| ID  | 問題                                                                                                                                         | 対応                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| R0a | `.gitignore` 済みの `node_modules/`（2,530 ファイル）と `dist/` が Git 管理されている                                                        | 追跡解除                                                                              |
| R0b | `npm audit` が high 3 件で CI の監査ゲートが失敗する。Dependabot PR 8 件が未処理で、three 更新は bundle 予算超過により CI 失敗               | 依存と Actions を更新し、bundle 予算を vendor / application に分離                    |
| R0c | CRLF 27 ファイルと LF 116 ファイルが混在                                                                                                     | LF へ統一し `.gitattributes` / Prettier で固定                                        |
| R1  | `Document` が transaction 用 snapshot / 復元 / 比較で全データ型のフィールドを `instanceof` で列挙（約 330 行）。`LayerCopy` にも同じ列挙あり | 型ごとの `captureState` / `restoreState` と汎用比較へ委譲                             |
| R2  | Node 参照判定が `Member \|\| Plane \|\| Support \|\| Constraint` の列挙で 5 箇所に重複。`nodeList` 等は呼出しごとに全件 filter               | `DocumentData.referencedNodes` / `remapNodes` を基底 API 化し、型別リストをキャッシュ |
| R3  | `main.ts`（707 行）にプロパティ編集、座標入力、ステータスバー、ショートカット、削除処理が混在                                                | Controller / UI 部品へ分割し、`main.ts` は結線だけにする                              |
| R4  | `localized(ja, en)` の直書き、レイヤー操作ボタンの固定文言、作業平面エラーの日本語固定など i18n が不統一                                     | `t(key, params)` に集約                                                               |

### 追加する機能（Web / GitHub 調査より）

SkyCiv Structural 3D、xeokit、That Open Engine、StbDiffViewer、frame-ts などを比較し、
静的サイトだけで実現でき、入力時間の短縮と手戻り防止に効くものを選んだ。

| ID  | 機能                                                           | 根拠                                                     |
| --- | -------------------------------------------------------------- | -------------------------------------------------------- |
| F1  | ツール切替ショートカット、全選択（Ctrl+A）、選択反転（Ctrl+I） | SkyCiv の単キー操作。既存 UI はマウス前提                |
| F2  | 選択要素の配列複写（オフセット × 個数）                        | SkyCiv Repeat。フレームは繰返しが多く最も入力を減らす    |
| F3  | モデル整理（重複節点の結合、孤立節点の削除）                   | SkyCiv Merge Nodes。既存の検証警告に対する修正手段       |
| F4  | 計測ツール（距離、ΔX / ΔY / ΔZ）                               | xeokit DistanceMeasurements、That Open LengthMeasurement |
| F5  | 数量集計（種別・断面別の本数、延長、面積）と CSV 出力          | SkyCiv Datasheets / BOM                                  |
| F6  | 出力（PNG 画像、DXF、節点・要素 CSV）                          | SkyCiv DXF export。Jw_cad / AutoCAD への受け渡し         |

### 今回は見送るもの

- 通り芯管理、ST-Bridge 出力、断面ライブラリと押出し表示: JSON schema の拡張が必要で、単独の計画として扱う
- IFC / SAF / glTF 出力、URL 共有、荷重表示、PWA: 依存サイズまたは対象ユーザーへの効果が見合わない
- TypeScript 7 / Vite 8 / Vitest 5 へのメジャー更新: ツールチェーンの互換確認を別 PR で行う

## 2. 実施順

1. [x] R0a 追跡解除
2. [x] R0b 依存更新・Actions 更新・bundle 予算
3. [x] R0c 改行コード統一
4. [x] R1 / R2 データ層リファクタリング
5. [x] R4 i18n パラメータ対応
6. [x] R3 `main.ts` 分割
7. [x] F1 ショートカットと選択操作
8. [x] F2 配列複写
9. [x] F3 モデル整理
10. [x] F4 計測ツール
11. [x] F5 数量集計
12. [x] F6 出力
13. [x] ヘルプ、README、version 1.1.0、単体 / E2E テスト
14. [ ] PR 作成、サブエージェントレビュー、指摘対応
15. [ ] 本ファイルと完了済みの `CODE_REVIEW_AND_ROADMAP.md` を削除、マージ、ブランチ整理

## 3. 完了条件

- `npm run check`（format / 型検査 / lint / coverage / build / bundle 予算）が成功
- `npm audit --audit-level=high` が 0 件
- Playwright E2E と visual regression が成功
- GitHub Actions（ubuntu-latest）の CI が成功
