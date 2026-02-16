# FrameModeler-Web: AIエージェント向け変換指示書

## 1. プロジェクト概要

本プロジェクトは、C# WinFormsで作られた建築構造フレームモデリングCADツール「Ebi_FrameModeler」を、GitHub Pagesで動作するWebアプリケーションに変換するものである。

### 元のC#アプリの機能
- 建築構造物（RC造/鉄骨造）のフレーム（骨組み）をモデリングするCADツール
- 節点(Node)、梁(Beam)、柱(Pillar)、床(Floor)、壁(Wall)、耐力壁(BearWall) を2D/3Dで配置・編集
- OpenGL (Tao.OpenGl) による3D表示とレイヤーベースの2D編集
- XML形式でのデータ保存/読込
- 構造計算用の中間ファイル(STAN3D形式)出力
- 荷重計算機能（地震・風・積載）

### Webアプリの目標
- 上記CAD機能をブラウザ上で再現する
- GitHub Pages（静的ホスティング）で動作する
- Three.js (WebGL) で3D表示を再現
- サーバーサイド不要（全てフロントエンド完結）

---

## 2. 技術スタック指定

| 項目 | 技術 |
|------|------|
| 言語 | TypeScript |
| ビルド | Vite |
| 3D描画 | Three.js |
| UI | HTML + CSS（フレームワークなし、シンプル構成） |
| データ形式 | XML（ブラウザDOMParser使用） |
| デプロイ | GitHub Pages (静的ビルド) |
| パッケージ管理 | npm |

---

## 3. C#ソースコードのアーキテクチャ（変換元）

### 3.1 ディレクトリ構成
```
Ebi_FrameModeler/
├── Ebi_FrameModeler/          # メインプロジェクト
│   ├── Data/                  # データモデル層
│   │   ├── Document.cs        # ★最重要: シングルトン文書管理クラス
│   │   ├── DocumentData.cs    # 全データの抽象基底クラス
│   │   ├── Node.cs            # 節点（3D座標を持つ）
│   │   ├── Member.cs          # 部材（2節点間の線要素）抽象基底
│   │   ├── Beam.cs            # 梁（Memberを継承）
│   │   ├── Pillar.cs          # 柱（Memberを継承）
│   │   ├── Plane.cs           # 面要素（複数節点）抽象基底
│   │   ├── Floor.cs           # 床（Planeを継承、荷重方向あり）
│   │   ├── Wall.cs            # 壁（Planeを継承）
│   │   ├── BearWall.cs        # 耐力壁（Planeを継承）
│   │   ├── Boundary.cs        # 境界条件
│   │   ├── INodeReferrer.cs   # Nodeを参照するインターフェース
│   │   ├── PointLoad.cs       # 点荷重
│   │   ├── LineLoad.cs        # 線荷重
│   │   ├── AreaLoad.cs        # 面荷重
│   │   ├── SlabInfo.cs        # スラブ情報
│   │   ├── LoadElement.cs     # 荷重要素
│   │   ├── EQ_Info.cs         # 地震情報
│   │   ├── EWeightG_Info.cs   # 層重量情報
│   │   └── NonElemDamper.cs   # 非要素ダンパー
│   ├── UI/                    # UI層
│   │   ├── MainForm.cs        # メインウィンドウ（ファイルメニュー、ツールバー）
│   │   ├── CadView.cs         # CADビューコントロール（GLControlを継承）
│   │   ├── ICadElement.cs     # CAD描画要素インターフェース
│   │   ├── ICadMouseHandler.cs # マウスハンドラインターフェース
│   │   ├── IDataDialog.cs     # データダイアログインターフェース
│   │   ├── Layer.cs           # レイヤー（Z座標で階を表現）
│   │   ├── SelectionHandler.cs # 選択モードハンドラ
│   │   ├── MoveNodeHandler.cs # 節点移動ハンドラ
│   │   ├── AddNodeHandler.cs  # 節点追加ハンドラ
│   │   ├── AddBeamHandler.cs  # 梁追加ハンドラ
│   │   ├── AddPillarHandler.cs # 柱追加ハンドラ
│   │   ├── AddFloorHandler.cs # 床追加ハンドラ
│   │   ├── AddWallHandler.cs  # 壁追加ハンドラ
│   │   ├── AddBearWallHandler.cs # 耐力壁追加ハンドラ
│   │   ├── NodeDialog.cs      # 節点プロパティダイアログ
│   │   ├── MemberDialog.cs    # 部材プロパティダイアログ
│   │   ├── PlaneDialog.cs     # 面要素プロパティダイアログ
│   │   ├── LayerSettingDialog.cs # レイヤー設定ダイアログ
│   │   └── LayerListPanel.cs  # レイヤーリストパネル
│   ├── IO/                    # 入出力層
│   │   ├── ObjectSerializer.cs   # XMLシリアライズ
│   │   ├── ObjectDeserializer.cs # XMLデシリアライズ
│   │   ├── Stan3DSaver.cs     # STAN3D出力
│   │   └── DivMember.cs       # 部材分割
│   ├── Load/                  # 荷重計算層
│   │   ├── LoadAdmini.cs      # 荷重管理
│   │   ├── ElementLoad.cs     # 要素荷重
│   │   ├── FloorLoad.cs       # 床荷重
│   │   ├── WallLoad.cs        # 壁荷重
│   │   └── NodeLoad.cs        # 節点荷重
│   ├── CalcInit.cs            # 計算初期条件
│   ├── WindLoadParam.cs       # 風荷重パラメータ
│   └── FloorElemMemo.cs       # 床要素メモ
├── GLUtil/                    # OpenGLユーティリティライブラリ
│   ├── GLControl.cs           # OpenGLコントロール（Tao.OpenGl使用）
│   ├── GLGraphics.cs          # 描画ラッパー（DrawLine, FillPolygon等）
│   ├── Point3D.cs             # 3Dベクトル構造体
│   ├── Point2D.cs             # 2Dベクトル構造体
│   ├── Texture.cs             # テクスチャ管理
│   └── TextureRepository.cs   # テクスチャリポジトリ
└── TestFile/                  # サンプルデータ
    ├── test.xml               # テスト用XMLファイル（大規模）
    ├── pillar_test.xml        # 柱テスト用XMLファイル（小規模）
    └── tset.xml               # テスト用XMLファイル
```

### 3.2 クラス継承・インターフェース構造

```
DocumentData (abstract)              ← 全データの基底: Number, Select, Save/Load
├── Node                             ← 節点: Point3D pos
│   implements ICadElement, IComparable<Node>
├── Member (abstract)                ← 部材: Node[2] (NodeI, NodeJ), Section
│   implements ICadElement, INodeReferrer
│   ├── Beam                         ← 梁: Section="G1"
│   └── Pillar                       ← 柱: Section="C1", 円形描画
├── Plane (abstract)                 ← 面: List<Node>, Section
│   implements ICadElement, INodeReferrer
│   ├── Floor                        ← 床: Weight, FloorDirection (X/Y/XY/DUMMY), Section="S1"
│   ├── Wall                         ← 壁: Weight, Height, Width, BM, ZLevel, Direct
│   └── BearWall                     ← 耐力壁: Section="V1", ブレース描画
├── PointLoad                        ← 点荷重
├── LineLoad                         ← 線荷重
├── AreaLoad                         ← 面荷重
└── NonElemDamper                    ← 非要素ダンパー

ICadElement (interface)
  - Draw(GLGraphics, CadView)
  - ExistsOn(Layer) → bool
  - Select { get; set; }
  - IsInside(Rectangle, CadView) → bool
  - CadId { get; }

ICadMouseHandler (interface)
  - OnClick(CadView, Point)
  - OnDoubleClick(CadView, Point)
  - OnDrag(CadView)
  - OnEndDrag(CadView)
  - OnMouseMove(CadView)
  - Draw(GLGraphics, CadView)

INodeReferrer (interface)
  - IsReferring(Node) → bool

IDataDialog (interface)
  - GetDataProperties(DocumentData)
  - SetDataProperties(DocumentData)
  - IsAcceptable(DocumentData) → bool
```

### 3.3 Document（シングルトン）の主要機能

Document.Instanceでアクセスする中央管理クラス:

| メソッド/プロパティ | 説明 |
|-----|------|
| `dataList: List<DocumentData>` | 全データの一元管理リスト |
| `Add(DocumentData)` | データ追加 → 自動ソート → 番号再割り当て |
| `Remove(DocumentData)` | データ削除（参照チェック付き） |
| `NodeList / MemberList / PlaneList` | 型別フィルタ取得 |
| `CadElementList` | ICadElement実装データ一覧 |
| `GetNodeAt(Point3D)` | 位置からNode検索（距離0.5以内） |
| `GetNodeByNumber(int)` | 番号からNode検索 |
| `GetNodeAbove(Point3D)` | 直上のNode検索（柱配置で使用） |
| `GetPosAbove(Point3D)` | 直上の位置または部材交点を返す |
| `GetMemberOf(Node, Node)` | 2節点間の部材取得 |
| `GetPlaneOf(List<Node>)` | 節点リストから面要素取得 |
| `SceneCenter` | 全節点の重心 |
| `CopyDataInZLevel(src_z, dst_z, range)` | レイヤー間コピー |
| `Save(filename)` / `Load(filename)` | XMLファイル保存/読込 |
| `NodeCadIdOffset=0, MemberCadIdOffset=100000, PlaneCadIdOffset=200000` | CadID管理 |

**データソート順序**: Node → Beam → Pillar → BearWall → Wall → Floor → PointLoad → LineLoad → AreaLoad → NonElemDamper

### 3.4 CadView（CADビュー）の主要機能

GLControlを継承した2D/3D切替可能なCADビューア:

| 機能 | 説明 |
|------|------|
| 2D/3D表示切替 | `Show3D`プロパティ。2D時は平面図、3D時はパース表示 |
| レイヤー | Z座標でレイヤーを定義。2D時は1レイヤーのみ表示 |
| グリッド表示 | 設定可能なグリッド幅でXY軸グリッド描画 |
| スナップ | 指定幅でのスナップ機能 |
| マウス操作 | 左:ハンドラ操作, 右ドラッグ:回転/パン, 中央:パン, ホイール:ズーム |
| 座標変換 | ViewToReal(スクリーン→ワールド), RealToView(ワールド→スクリーン) |
| ヒットテスト | OpenGLセレクションモードによる要素ピック |
| カメラ | Eye, Center, Up, ViewAngle, Perspective/Ortho切替 |

### 3.5 マウスハンドラの動作仕様

| ハンドラ | 操作 | 動作 |
|---------|------|------|
| SelectionHandler | クリック | 要素選択（Shift:追加, Ctrl:反転）。ダブルクリック:プロパティ表示 |
| SelectionHandler | ドラッグ | 矩形選択 |
| MoveNodeHandler | クリック→移動→クリック | 選択Node移動 |
| AddNodeHandler | クリック | 位置にNode追加（既存なら何もしない） |
| AddBeamHandler | クリック2回 | Node→Node間にBeam追加。プレビュー線表示 |
| AddPillarHandler | クリック | 現レイヤーと上レイヤーの間にPillar追加 |
| AddFloorHandler | クリック2回 | 矩形の4節点Floor追加。ダブルクリックで方向切替(X↔Y) |
| AddWallHandler | クリック2回 | 現レイヤーから上レイヤーまでの4節点Wall追加 |
| AddBearWallHandler | クリック2回 | 現レイヤーから上レイヤーまでの4節点BearWall追加 |

---

## 4. XMLデータ形式

### 4.1 ファイル構造
```xml
<FrameModellerDocument>
  <!-- 旧形式の場合、ルート名は "FrameModellerDocument" -->
  <!-- 新形式は "Ebi_FrameModelerDocument" -->

  <!-- オプション: フレームタイプ -->
  <object classname="Ebi_FrameModeler.Data.FrameType">
    <Frame>R_raum</Frame>
  </object>

  <!-- Node: 節点 -->
  <object classname="FrameModeller.Data.Node">
    <Number>0</Number>
    <Select>False</Select>
    <Pos>200 300 275</Pos>   <!-- "x y z" スペース区切り float -->
  </object>

  <!-- Beam: 梁 -->
  <object classname="FrameModeller.Data.Beam">
    <Number>0</Number>
    <Select>False</Select>
    <NodeI>18</NodeI>          <!-- Node番号参照 -->
    <NodeJ>33</NodeJ>
  </object>

  <!-- Pillar: 柱 -->
  <object classname="FrameModeller.Data.Pillar">
    <Number>32</Number>
    <Select>False</Select>
    <NodeI>44</NodeI>
    <NodeJ>53</NodeJ>
  </object>

  <!-- Floor: 床 -->
  <object classname="FrameModeller.Data.Floor">
    <Number>9</Number>
    <Select>False</Select>
    <NodeCount>4</NodeCount>
    <Node0>70</Node0>
    <Node1>69</Node1>
    <Node2>44</Node2>
    <Node3>10</Node3>
    <Weight>0</Weight>
    <Direction>X</Direction>    <!-- X, Y, XY, DUMMY -->
  </object>

  <!-- Wall: 壁 -->
  <object classname="FrameModeller.Data.Wall">
    <Number>4</Number>
    <Select>False</Select>
    <NodeCount>4</NodeCount>
    <Node0>69</Node0>
    <Node1>66</Node1>
    <Node2>15</Node2>
    <Node3>20</Node3>
    <Weight>0</Weight>
  </object>

  <!-- BearWall: 耐力壁 -->
  <object classname="FrameModeller.Data.BearWall">
    <Number>0</Number>
    <Select>False</Select>
    <NodeCount>4</NodeCount>
    <Node0>54</Node0>
    <Node1>63</Node1>
    <Node2>66</Node2>
    <Node3>69</Node3>
  </object>

  <!-- Layer: レイヤー（階レベル） -->
  <object classname="FrameModeller.UI.Layer">
    <Name>新規レイヤー</Name>
    <PosZ>0</PosZ>              <!-- Z座標(mm単位) -->
  </object>
</FrameModellerDocument>
```

### 4.2 classname対応表（旧形式→新形式）
読込時は両方の形式名を認識する必要がある:

| 旧形式 classname | 新形式 classname | データ型 |
|---|---|---|
| FrameModeller.Data.Node | Ebi_FrameModeler.Data.Node | Node |
| FrameModeller.Data.Beam | Ebi_FrameModeler.Data.Beam | Beam |
| FrameModeller.Data.Pillar | Ebi_FrameModeler.Data.Pillar | Pillar |
| FrameModeller.Data.Floor | Ebi_FrameModeler.Data.Floor | Floor |
| FrameModeller.Data.Wall | Ebi_FrameModeler.Data.Wall | Wall |
| FrameModeller.Data.BearWall | Ebi_FrameModeler.Data.BearWall | BearWall |
| FrameModeller.UI.Layer | Ebi_FrameModeler.UI.Layer | Layer |

### 4.3 データ読込時の注意
- NodeはNumber順でソートされた後、他要素から**番号参照**される
- Member (Beam/Pillar) は読込時にNodeI/NodeJの座標を比較し、原点に近い方をNodeIとする
- Plane (Floor/Wall/BearWall) はNodeCount個のNode参照(Node0, Node1, ...)を持つ

---

## 5. 描画仕様（Three.jsへの変換指針）

### 5.1 要素別描画方法

| 要素 | C#描画 | Three.js変換先 |
|------|--------|----------------|
| Node | 点描画 (glPointSize=8, 青/赤) | THREE.Points (SphereGeometry小球でもOK) |
| Beam | 線描画 (LineWidth=2, 青/赤) | THREE.Line / LineSegments |
| Pillar(2D) | 円描画 (FillCircle, radius=10px相当) | CircleGeometry |
| Pillar(3D) | 線描画 | THREE.Line |
| Floor | 多角形塗りつぶし (半透明青/赤) | THREE.Mesh + PlaneGeometry |
| Wall | 箱型描画 (法線方向に厚み) | THREE.Mesh + BoxGeometry的 |
| BearWall | 塗りつぶし + ブレース対角線 | THREE.Mesh + THREE.Line |
| Grid | X/Y方向の線 (灰色) | THREE.GridHelper |
| 座標軸 | X=赤, Y=緑, Z=青 | THREE.AxesHelper |

### 5.2 色の仕様
- 未選択: 青 (Color.Blue)
- 選択中: 赤 (Color.Red)
- 非表示レイヤー要素: alpha半減（薄く表示）
- 壁: 緑系半透明
- 床方向矢印: 黄色
- グリッド: 灰色 (160,160,160)

### 5.3 カメラ制御
- 2Dモード: 正射影(Orthographic)、Z軸方向から見下ろし、Up=Y方向
- 3Dモード: 透視投影(Perspective)、任意視点、Up=Z方向
- ズーム: Eye-Center間距離の拡縮（マウスホイール、ratio=1.2）
- パン(2D): Center/Eye平行移動（右ドラッグ/中央ドラッグ）
- 回転(3D): 球面座標系でのEye回転（右ドラッグ）

---

## 6. Web版ディレクトリ構成

```
FrameModeler-Web/
├── README.md                  # 本指示書
├── CLAUDE.md                  # AIエージェント設定
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html                 # エントリHTML
├── sample-data/               # サンプルXMLファイル
│   ├── test.xml
│   ├── pillar_test.xml
│   └── tset.xml
├── src/
│   ├── main.ts                # エントリポイント
│   ├── data/                  # データモデル層
│   │   ├── Document.ts        # 文書管理（シングルトン）
│   │   ├── DocumentData.ts    # 基底クラス
│   │   ├── Node.ts
│   │   ├── Member.ts
│   │   ├── Beam.ts
│   │   ├── Pillar.ts
│   │   ├── Plane.ts
│   │   ├── Floor.ts
│   │   ├── Wall.ts
│   │   └── BearWall.ts
│   ├── math/                  # 数学ユーティリティ
│   │   ├── Point3D.ts         # THREE.Vector3のラッパーまたは独自実装
│   │   └── Point2D.ts
│   ├── io/                    # 入出力
│   │   ├── XmlSerializer.ts
│   │   └── XmlDeserializer.ts
│   ├── ui/                    # UI層
│   │   ├── CadView.ts         # Three.jsベースのCADビュー
│   │   ├── CadRenderer.ts     # 要素描画ロジック
│   │   ├── Layer.ts
│   │   ├── handlers/          # マウスハンドラ
│   │   │   ├── ICadMouseHandler.ts
│   │   │   ├── SelectionHandler.ts
│   │   │   ├── MoveNodeHandler.ts
│   │   │   ├── AddNodeHandler.ts
│   │   │   ├── AddBeamHandler.ts
│   │   │   ├── AddPillarHandler.ts
│   │   │   ├── AddFloorHandler.ts
│   │   │   ├── AddWallHandler.ts
│   │   │   └── AddBearWallHandler.ts
│   │   └── dialogs/           # プロパティダイアログ（HTMLモーダル）
│   │       ├── NodeDialog.ts
│   │       ├── MemberDialog.ts
│   │       └── PlaneDialog.ts
│   └── styles/
│       └── main.css
└── public/
    └── (静的アセット)
```

---

## 7. 実装フェーズ

### Phase 1: プロジェクトセットアップとデータモデル
1. Vite + TypeScriptプロジェクト初期化
2. Three.js依存追加
3. Point3D / Point2D 実装
4. DocumentData, Node, Member, Beam, Pillar, Plane, Floor, Wall, BearWall 実装
5. Document（シングルトン）実装（dataList管理、ソート、番号割当、検索）

### Phase 2: XML入出力
1. XmlDeserializer実装（DOMParser使用）
2. XmlSerializer実装
3. サンプルXML (sample-data/) の読込テスト

### Phase 3: 3Dビューア基盤
1. Three.jsシーン/カメラ/レンダラー構築
2. グリッド・座標軸描画
3. 2D/3Dカメラ切替
4. マウスによるパン/ズーム/回転
5. 各要素の描画（Node, Beam, Pillar, Floor, Wall, BearWall）

### Phase 4: レイヤーシステムとUI
1. Layer管理
2. レイヤーリストパネル（HTML）
3. ツールバー（モード切替ボタン群）
4. ファイルメニュー（開く/保存/新規）
5. ステータスバー（マウス座標表示）

### Phase 5: マウスハンドラ（インタラクション）
1. SelectionHandler（クリック選択、矩形選択）
2. AddNodeHandler
3. AddBeamHandler（2点指定）
4. AddPillarHandler（現レイヤー→上レイヤー自動検出）
5. AddFloorHandler（矩形指定）
6. AddWallHandler / AddBearWallHandler
7. MoveNodeHandler

### Phase 6: プロパティダイアログ
1. NodeDialog（座標編集）
2. MemberDialog（断面記号編集）
3. PlaneDialog（断面記号、重量、方向編集）

### Phase 7: 仕上げとデプロイ
1. ファイルドラッグ＆ドロップ対応
2. XMLダウンロード保存
3. GitHub Pagesデプロイ設定（vite build → docs/ or dist/）
4. レスポンシブ対応

---

## 8. 重要な実装上の注意

### 8.1 座標系
- C#元アプリの座標系: X=右, Y=奥, Z=上（建築標準）
- Three.jsデフォルト: X=右, Y=上, Z=手前
- **対応**: Three.jsのカメラ設定でZ-upに合わせるか、座標変換を行う
- 推奨: `camera.up.set(0, 0, 1)` でZ-up設定

### 8.2 単位
- 全座標値はmm単位
- グリッドデフォルト幅: 100mm（元は610mm→305mmスナップ設定あり）

### 8.3 Nodeの参照整合性
- MemberやPlaneはNodeを番号で参照する
- Node削除時は参照チェック必須（INodeReferrer.IsReferring）
- 参照があるNodeは削除不可

### 8.4 データソートと番号管理
- 全データは型優先でソート: Node → Beam → Pillar → BearWall → Wall → Floor → ...
- ソート後に型別で0から連番を振り直す
- CadIDは型別オフセット: Node=+0, Member=+100000, Plane=+200000

### 8.5 レイヤーとZ座標
- Layer.PosZで階レベルを定義
- 2D表示時は選択レイヤーのZ座標平面のみ表示
- 柱追加時に「直上のNodeまたは部材交点」を自動検索する仕組みが必要

---

## 9. サンプルデータ説明

### sample-data/pillar_test.xml（小規模テスト用）
- Node: 19個（Z=0とZ=200の2層）
- Beam: 3本
- Pillar: 9本
- Layer: 2層 (Z=0, Z=200)

### sample-data/test.xml（大規模テスト用）
- Node: 88個（Z=0, Z=200, Z=350の3層）
- Beam: 32本
- Pillar: 37本
- BearWall: 4枚
- Wall: 5枚
- Floor: 9枚
- Layer: 3層 (Z=0, Z=200, Z=350)
