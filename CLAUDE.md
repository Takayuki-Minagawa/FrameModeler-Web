# CLAUDE.md - FrameModeler-Web

## プロジェクト概要
C# WinFormsベースの建築構造フレームモデリングCADツールを、TypeScript + Three.js のWebアプリケーションに変換するプロジェクト。GitHub Pagesで静的ホスティング。

## 必ず最初にREADME.mdを読むこと
README.mdに変換元C#の全アーキテクチャ、データ構造、XML形式、描画仕様、実装フェーズが記載されている。作業開始前に必ず通読すること。

## 技術スタック
- TypeScript + Vite
- Three.js (WebGL 3D描画)
- HTML + CSS (UIフレームワーク不使用)
- XMLデータ形式 (DOMParser)

## ビルドコマンド
```bash
npm install          # 依存パッケージインストール
npm run dev          # 開発サーバー起動
npm run build        # 本番ビルド
npm run preview      # ビルド結果プレビュー
```

## ディレクトリ構成
```
src/
├── main.ts           # エントリポイント
├── data/             # データモデル (Document, Node, Beam, Pillar, Floor, Wall等)
├── math/             # Point3D, Point2D
├── io/               # XML入出力
├── ui/               # CadView, CadRenderer, ハンドラ, ダイアログ
│   ├── handlers/     # マウスハンドラ群
│   └── dialogs/      # プロパティダイアログ
└── styles/           # CSS
```

## 座標系の注意
- 元C#: X=右, Y=奥, Z=上 (建築標準, mm単位)
- Three.jsでもZ-upに設定: `camera.up.set(0, 0, 1)`

## テスト用サンプルデータ
- `sample-data/pillar_test.xml` - 小規模 (19Node, 3Beam, 9Pillar, 2層)
- `sample-data/test.xml` - 大規模 (88Node, 32Beam, 37Pillar, 壁/床あり, 3層)

## 実装上の重要ルール
1. DocumentはシングルトンパターンでdataListを一元管理
2. データ追加時は自動ソート→番号再割当
3. Node削除前に参照チェック必須
4. XMLの旧形式classname (FrameModeller.*) と新形式 (Ebi_FrameModeler.*) の両方に対応
5. Point3Dの文字列形式は "x y z" スペース区切り
