# 置換済み線材モデル読込確認手順

## 目的

`Test0202_calc.yaml` を、オリジナル CAD 面 (`traceability.source_surfaces`) ではなく、解析用に置き直された `model.nodes` / `model.elements` の線材モデルとして読み込んで表示できるかを確認する。

ここでいう線材モデルは、YAML 内の生成済み解析要素を FrameModeler-Web の `Node` と `Beam` に変換して表示する方式を指す。

## 確認対象

- 入力ファイル: `/Users/mina25/Desktop/Test0202_calc.yaml`
- 同一サンプル: `sample-data/Test0202_calc.yaml`
- 現行 importer: `src/io/CalcYamlDeserializer.ts`
- 現行保存形式: JSON のまま維持

## 実装後の確認結果

この手順をもとに、読込時に次の 2 モードを選択できるようにした。

- 元 CAD 形状: 既存互換の `traceability.source_*` ベース読込
- 生成済み解析要素: `model.nodes` / `model.elements` ベースの線材読込

`deserializeCalcYaml(yamlString)` の既定動作は従来通り元 CAD 形状のまま維持し、UI で YAML を開く時だけモード選択ダイアログを表示する。

## 確認結果

### 1. YAML 自体は現行 importer で読み込める

デスクトップ上のファイルとリポジトリ内サンプルは同一だった。

```bash
shasum -a 256 /Users/mina25/Desktop/Test0202_calc.yaml sample-data/Test0202_calc.yaml
```

結果:

```text
21e0653a3dc9f8fe6a98128e8cc41d955ca46f091edd2dcc77f17196b7f8d207  /Users/mina25/Desktop/Test0202_calc.yaml
21e0653a3dc9f8fe6a98128e8cc41d955ca46f091edd2dcc77f17196b7f8d207  sample-data/Test0202_calc.yaml
```

既存テストも成功している。

```bash
npm test -- --run tests/CalcYamlDeserializer.test.ts
```

結果:

```text
tests/CalcYamlDeserializer.test.ts (25 tests) passed
```

既定の importer は `traceability.source_*` を主入力にしており、解析メッシュではなく元 CAD 形状に近い状態へ復元する仕様である。元 CAD 形状モードでは、結果は次の CAD モデルになる。

- Node: 10
- Beam: 6
- Floor: 4
- Layer: 1

つまり、既定では「オリジナル面を Floor として復元する表示」になる。

### 2. YAML には置換済み線材モデルに必要なデータが含まれている

`model.nodes` と `model.elements` を確認した結果、線材表示に必要な節点・要素は存在する。

```bash
node - <<'NODE'
const fs = require('fs');
const YAML = require('yaml');
const doc = YAML.parse(fs.readFileSync('/Users/mina25/Desktop/Test0202_calc.yaml', 'utf8'));
const model = doc.model;
const counts = (arr, key = 'type') =>
  Object.fromEntries(Object.entries((arr || []).reduce((a, x) => {
    const k = x?.[key] ?? '(missing)';
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {})).sort());
console.log(JSON.stringify({
  nodes: model.nodes?.length ?? 0,
  elements: model.elements?.length ?? 0,
  elementTypes: counts(model.elements),
  supports: model.supports?.length ?? 0,
  nodal_masses: model.nodal_masses?.length ?? 0,
  constraints: model.constraints?.length ?? 0,
}, null, 2));
NODE
```

結果:

```json
{
  "nodes": 76,
  "elements": 79,
  "elementTypes": {
    "elasticTimoshenkoBeam3D": 64,
    "truss3D": 2,
    "twoNodeLink3D": 13
  },
  "supports": 68,
  "nodal_masses": 64,
  "constraints": 72
}
```

### 3. 線材化した場合の表示可能性

FrameModeler-Web は `Beam` を 2 節点間の線として描画しているため、生成済み要素を `Beam` に変換すれば表示できる。

想定変換:

| YAML 要素 type | FrameModeler-Web 表示 | 備考 |
|---|---|---|
| `elasticTimoshenkoBeam3D` | `Beam` | 通常の梁・床置換梁として表示可能 |
| `truss3D` | `Beam` | 専用 brace/truss クラスがないため Beam 表示 |
| `twoNodeLink3D` | `Beam` または警告付き Beam | 回転ばね。解析要素確認用なら表示可能だが、通常部材とは区別が必要 |

節点参照と要素長を確認したところ、欠落参照やゼロ長要素はなかった。

```text
missingRefs: 0
zeroOrTiny: 0

elasticTimoshenkoBeam3D: 64 elements, length 250-250 mm
truss3D: 2 elements, length 2828.427 mm
twoNodeLink3D: 13 elements, length 1-500 mm
```

したがって、データとしては「置換済み線材モデル」として読み込んで表示可能である。

## 実装した差分

現行 `CalcYamlDeserializer` の処理は次の流れになっている。

1. `model.traceability.source_nodes` から元 CAD 節点を作る
2. `model.traceability.source_members` から元 CAD 部材を Beam として作る
3. `model.traceability.source_surfaces` から元 CAD 面を Floor として作る
4. `generated_element_chain` は材料・断面情報の参照用に使うが、表示要素としては展開しない

生成済み解析要素モードでは、`model.elements` を主入力にする別経路を追加した。

## 実装手順

### フェーズ 1: 読込モードを分ける

既存の「元 CAD 形状復元」モードを壊さず、次のどちらかで線材表示モードを追加する。

- 案 A: `deserializeCalcYaml(yamlString, { mode: 'source' | 'generated' })`
- 案 B: `deserializeCalcGeneratedYaml(yamlString)` を新設

保存形式は現状通り JSON のままにし、YAML 独自の材料表・断面表・トレーサビリティは `ImportMetadata` に保持する。

### フェーズ 2: `model.nodes` を Node に変換する

1. `model.nodes` を読む
2. `tag` を source node ID として保持する
3. `x`, `y`, `z` から `Point3D` を作る
4. `tag -> Node` の Map を作る
5. z 値の一覧から Layer を作る

今回のファイルでは全節点が z=2800 のため 1 レイヤーで表示可能。

### フェーズ 3: `model.elements` を Beam に変換する

1. `elasticTimoshenkoBeam3D`, `truss3D`, `twoNodeLink3D` を対象にする
2. `node_i`, `node_j` から Node を引く
3. 欠落参照があればエラー
4. 同一 Node またはゼロ長ならエラーまたは警告
5. `Beam(nodeI, nodeJ)` を作成
6. `section_ref` があれば `beam.section` に入れる
7. `section_ref` がない `truss3D` / `twoNodeLink3D` は要素 type 由来の section 名を入れる

例:

- `elasticTimoshenkoBeam3D` + `section_ref: B` -> `section = B`
- `elasticTimoshenkoBeam3D` + `section_ref: ALC_S_center_beam` -> `section = ALC_S_center_beam`
- `truss3D` -> `section = truss3D`
- `twoNodeLink3D` -> `section = twoNodeLink3D`

### フェーズ 4: 元情報の対応を保持する

生成済み要素を選択したときに確認できるよう、`ImportMetadata` に次を入れる。

- YAML element tag
- YAML element type
- node_i / node_j
- material_ref
- section_ref
- source member/surface との対応

`traceability.source_members[].generated_element_chain` と `traceability.source_surfaces[].generated_element_chain` を逆引きして、生成要素 tag から元の `M001` や `S001` を表示できるようにする。

### フェーズ 5: UI 表示

最小対応では既存の `Beam` 描画を使うため、描画側の大きな修正は不要。

ただし、通常の Beam と解析用のばね・床置換梁が同じ色で見えると判別しづらいため、将来的には以下を検討する。

- `twoNodeLink3D` を別色または破線表示
- `ALC_S_center_beam` を床置換梁として別色表示
- 読込情報ダイアログで「元要素」と「生成要素」を分けて表示

## 受け入れ確認項目

線材表示モードを実装した場合、今回の YAML では次を合格条件にする。

- 読込後 Node が 76 件になる
- 読込後 Beam が 79 件になる
- Floor は 0 件になる
- 欠落節点参照エラーがない
- ゼロ長 Beam がない
- `elasticTimoshenkoBeam3D` 64 件が表示される
- `truss3D` 2 件が表示される
- `twoNodeLink3D` 13 件が表示される
- `twoNodeLink3D` は `SPRINGS_IMPORTED_AS_BEAM` として表示用 Beam 変換を警告する
- 材料 `steel`, `alc` と断面 `B`, `ALC_S_center_beam` を読込情報で確認できる
- 既存の元 CAD 形状復元モードは従来通り 10 Node / 6 Beam / 4 Floor で読み込める

## 実行した検証

```bash
npm test -- --run tests/CalcYamlDeserializer.test.ts
npm test
npm run build
```

対象 deserializer テストでは source モード回帰と generated モードの新規テストを追加し、以下を確認する。

- 既定/source モードは従来通り 10 Node / 6 Beam / 4 Floor / 1 Layer
- generated モードは 76 Node / 79 Beam / 0 Floor / 1 Layer
- 同一座標でも YAML node tag が異なる節点は統合しない
- generated element の type / section / material / 元 source 逆引きが読込情報に残る
- `twoNodeLink3D` は未読込警告ではなく表示用 Beam として扱う
- JSON 保存形式には materials / sections / traceability / importMetadata を出さない
- JSON round-trip 後は件数を維持し、import metadata は消える
- missing generated node 参照時は Document を変更せずエラーにする

## 結論

`Test0202_calc.yaml` は、元 CAD 形状復元モードと生成済み解析要素モードの両方で読み込める。

生成済み解析要素モードでは、YAML 内の `model.nodes` と `model.elements` を使い、既存の `Node` / `Beam` データモデルと描画機構で置換済み解析要素を線材として表示する。
