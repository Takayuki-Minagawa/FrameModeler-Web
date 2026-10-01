import type { Document } from '../data/Document';
import type { DocumentData, DocumentDataKind } from '../data/DocumentData';
import type { Layer } from '../data/Layer';
import { Member } from '../data/Member';
import { Node } from '../data/Node';
import { Plane } from '../data/Plane';
import { Point3D } from '../math/Point3D';

export interface DxfExportOptions {
  /**
   * 指定すると、その階に存在する要素だけを平面図として出力する（Z はすべて階の高さ）。
   * null の場合は全要素を3D座標のまま出力する。
   */
  layer: Layer | null;
  /** 出力対象の絞り込み（非表示要素の除外など）。省略時は全要素。 */
  include?: (data: DocumentData) => boolean;
  /** 断面名などの文字高さ (mm)。 */
  textHeight?: number;
  /** 平面図で、階を貫く線材（柱など）を表す円の半径 (mm)。 */
  columnSymbolRadius?: number;
}

/** 種別ごとのDXFレイヤー名とAutoCAD Color Index。 */
const DXF_LAYERS: Record<DocumentDataKind | 'text', { name: string; color: number } | null> = {
  node: { name: 'NODE', color: 5 },
  beam: { name: 'BEAM', color: 5 },
  pillar: { name: 'PILLAR', color: 1 },
  truss: { name: 'TRUSS', color: 30 },
  spring: { name: 'SPRING', color: 6 },
  floor: { name: 'FLOOR', color: 8 },
  wall: { name: 'WALL', color: 3 },
  bearWall: { name: 'BEARWALL', color: 94 },
  support: null,
  constraint: null,
  text: { name: 'SECTION', color: 7 },
};

const ELEVATION_TOLERANCE = 1e-6;

/**
 * モデルを ASCII DXF (R12 / AC1009) として出力する。単位は mm。
 * R12 は Jw_cad、AutoCAD、LibreCAD など主要CADが読み込める最も互換性の高い形式である。
 */
export function exportDxf(document: Document, options: DxfExportOptions): string {
  const { layer } = options;
  const include = options.include ?? (() => true);
  const textHeight = options.textHeight ?? 150;
  const columnRadius = options.columnSymbolRadius ?? 150;
  const writer = new DxfWriter();

  writer.beginFile();
  for (const data of document.allDataList) {
    if (!include(data)) continue;
    if (layer && !data.existsOn(layer)) continue;
    const dxfLayer = DXF_LAYERS[data.kind];
    if (!dxfLayer) continue;

    if (data instanceof Node) {
      writer.point(dxfLayer.name, data.pos);
    } else if (data instanceof Member && data.ok) {
      writeMember(writer, data, dxfLayer.name, layer, columnRadius, textHeight);
    } else if (data instanceof Plane && data.nodeCount >= 2) {
      writePlane(writer, data, dxfLayer.name, layer, textHeight);
    }
  }
  return writer.endFile();
}

function writeMember(
  writer: DxfWriter,
  member: Member,
  layerName: string,
  layer: Layer | null,
  columnRadius: number,
  textHeight: number,
): void {
  const from = member.posI;
  const to = member.posJ;
  if (!layer) {
    writer.line(layerName, from, to);
    writer.text(DXF_LAYERS.text!.name, midpoint(from, to), textHeight, member.section);
    return;
  }

  const z = layer.posZ;
  const inPlane = onElevation(from, z) && onElevation(to, z);
  if (inPlane) {
    writer.line(layerName, flatten(from, z), flatten(to, z));
    writer.text(DXF_LAYERS.text!.name, flatten(midpoint(from, to), z), textHeight, member.section);
    return;
  }
  // 階を貫く線材は、階の高さとの交点に円で表す。
  const span = to.z - from.z;
  const ratio = Math.abs(span) <= ELEVATION_TOLERANCE ? 0 : (z - from.z) / span;
  const crossing = from.add(to.sub(from).scale(Math.min(1, Math.max(0, ratio))));
  writer.circle(layerName, flatten(crossing, z), columnRadius);
  writer.text(
    DXF_LAYERS.text!.name,
    new Point3D(crossing.x + columnRadius, crossing.y + columnRadius, z),
    textHeight,
    member.section,
  );
}

function writePlane(writer: DxfWriter, plane: Plane, layerName: string, layer: Layer | null, textHeight: number): void {
  const points = plane.nodeList.map((node) => node.pos);
  if (!layer) {
    writer.polyline(layerName, points, true, true);
    return;
  }

  const z = layer.posZ;
  if (points.every((point) => onElevation(point, z))) {
    writer.polyline(
      layerName,
      points.map((point) => flatten(point, z)),
      true,
      false,
    );
    writer.text(DXF_LAYERS.text!.name, flatten(Point3D.average(points), z), textHeight, plane.section);
    return;
  }
  // 壁など階に立つ面は、階の高さにある辺（無ければ平面投影した外形）を線で表す。
  const onLayer = points.filter((point) => onElevation(point, z));
  const footprint = uniqueInPlan(onLayer.length >= 2 ? onLayer : points);
  if (footprint.length < 2) return;
  writer.polyline(
    layerName,
    footprint.map((point) => flatten(point, z)),
    false,
    false,
  );
  writer.text(DXF_LAYERS.text!.name, flatten(Point3D.average(footprint), z), textHeight, plane.section);
}

function onElevation(point: Point3D, z: number): boolean {
  return Math.abs(point.z - z) <= ELEVATION_TOLERANCE;
}

function flatten(point: Point3D, z: number): Point3D {
  return new Point3D(point.x, point.y, z);
}

function midpoint(a: Point3D, b: Point3D): Point3D {
  return a.add(b).div(2);
}

function uniqueInPlan(points: ReadonlyArray<Point3D>): Point3D[] {
  const result: Point3D[] = [];
  for (const point of points) {
    if (!result.some((other) => Math.hypot(other.x - point.x, other.y - point.y) <= ELEVATION_TOLERANCE)) {
      result.push(point);
    }
  }
  return result;
}

/** group code と値の対を1行ずつ書き出す最小限のDXF writer。 */
class DxfWriter {
  private readonly lines: string[] = [];

  beginFile(): void {
    this.pair(0, 'SECTION');
    this.pair(2, 'HEADER');
    this.pair(9, '$ACADVER');
    this.pair(1, 'AC1009');
    this.pair(0, 'ENDSEC');

    this.pair(0, 'SECTION');
    this.pair(2, 'TABLES');
    this.pair(0, 'TABLE');
    this.pair(2, 'LTYPE');
    this.pair(70, 1);
    this.pair(0, 'LTYPE');
    this.pair(2, 'CONTINUOUS');
    this.pair(70, 0);
    this.pair(3, 'Solid line');
    this.pair(72, 65);
    this.pair(73, 0);
    this.pair(40, 0);
    this.pair(0, 'ENDTAB');

    const layers = Object.values(DXF_LAYERS).filter((entry): entry is { name: string; color: number } => !!entry);
    this.pair(0, 'TABLE');
    this.pair(2, 'LAYER');
    this.pair(70, layers.length);
    for (const layer of layers) {
      this.pair(0, 'LAYER');
      this.pair(2, layer.name);
      this.pair(70, 0);
      this.pair(62, layer.color);
      this.pair(6, 'CONTINUOUS');
    }
    this.pair(0, 'ENDTAB');
    this.pair(0, 'ENDSEC');

    this.pair(0, 'SECTION');
    this.pair(2, 'ENTITIES');
  }

  endFile(): string {
    this.pair(0, 'ENDSEC');
    this.pair(0, 'EOF');
    return this.lines.join('\r\n') + '\r\n';
  }

  point(layer: string, position: Point3D): void {
    this.pair(0, 'POINT');
    this.pair(8, layer);
    this.coordinates(10, position);
  }

  line(layer: string, from: Point3D, to: Point3D): void {
    this.pair(0, 'LINE');
    this.pair(8, layer);
    this.coordinates(10, from);
    this.coordinates(11, to);
  }

  circle(layer: string, center: Point3D, radius: number): void {
    this.pair(0, 'CIRCLE');
    this.pair(8, layer);
    this.coordinates(10, center);
    this.pair(40, radius);
  }

  polyline(layer: string, points: ReadonlyArray<Point3D>, closed: boolean, threeDimensional: boolean): void {
    this.pair(0, 'POLYLINE');
    this.pair(8, layer);
    this.pair(66, 1);
    this.coordinates(10, new Point3D(0, 0, threeDimensional ? 0 : (points[0]?.z ?? 0)));
    this.pair(70, (closed ? 1 : 0) | (threeDimensional ? 8 : 0));
    for (const point of points) {
      this.pair(0, 'VERTEX');
      this.pair(8, layer);
      this.coordinates(10, point);
      this.pair(70, threeDimensional ? 32 : 0);
    }
    this.pair(0, 'SEQEND');
    this.pair(8, layer);
  }

  text(layer: string, position: Point3D, height: number, value: string): void {
    const content = escapeText(value);
    if (content === '') return;
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    this.coordinates(10, position);
    this.pair(40, height);
    this.pair(1, content);
  }

  private coordinates(code: number, point: Point3D): void {
    this.pair(code, point.x);
    this.pair(code + 10, point.y);
    this.pair(code + 20, point.z);
  }

  private pair(code: number, value: string | number): void {
    this.lines.push(String(code), typeof value === 'number' ? formatNumber(value) : value);
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const text = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

/**
 * TEXT の値を R12 で安全な ASCII にする。
 * - R12 は文字コードを宣言できないため、非ASCII文字は UTF-16 単位ごとに `\U+XXXX`（4桁固定）へ置き換える
 * - 改行と制御文字は除く
 * - `%%`（%%u などの書式コード）と `^`（^J などの制御文字）が特殊な意味で解釈されないようにする
 */
function escapeText(value: string): string {
  let result = '';
  const text = value.trim().replace(/%{2,}/g, '%');
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) continue;
    if (code === 0x5e) result += '^ ';
    else if (code < 0x80) result += text[index];
    else result += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return result;
}
