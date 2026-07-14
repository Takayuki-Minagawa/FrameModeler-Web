import type { DocumentData } from '../data/DocumentData';
import { Floor } from '../data/Floor';
import type { Layer } from '../data/Layer';
import { Member } from '../data/Member';
import { Node } from '../data/Node';
import { Plane } from '../data/Plane';
import { Point3D } from '../math/Point3D';
import { Wall } from '../data/Wall';
import { Spring } from '../data/Spring';

export const DISPLAY_LABEL_OPTIONS = [
  'nodeNumber',
  'memberNumber',
  'planeNumber',
  'section',
  'floorDirection',
  'weight',
  'storyHeight',
  'localAxes',
] as const;

export type DisplayLabelOption = (typeof DISPLAY_LABEL_OPTIONS)[number];

export interface DisplayLabelSettings {
  readonly nodeNumber: boolean;
  readonly memberNumber: boolean;
  readonly planeNumber: boolean;
  readonly section: boolean;
  readonly floorDirection: boolean;
  readonly weight: boolean;
  readonly storyHeight: boolean;
  readonly localAxes: boolean;
}

export const DEFAULT_DISPLAY_LABEL_SETTINGS: Readonly<DisplayLabelSettings> = Object.freeze({
  nodeNumber: false,
  memberNumber: false,
  planeNumber: false,
  section: false,
  floorDirection: false,
  weight: false,
  storyHeight: false,
  localAxes: false,
});

/** ラベル表示トグル。DOMやThree.jsを持たず、設定パネルから直接操作できる。 */
export class DisplayLabelOptions {
  private current: Readonly<DisplayLabelSettings>;

  constructor(initial: Partial<DisplayLabelSettings> = {}) {
    this.current = mergeLabelSettings(DEFAULT_DISPLAY_LABEL_SETTINGS, initial);
  }

  get settings(): Readonly<DisplayLabelSettings> {
    return this.current;
  }

  isEnabled(option: DisplayLabelOption): boolean {
    return this.current[option];
  }

  setEnabled(option: DisplayLabelOption, enabled: boolean): Readonly<DisplayLabelSettings> {
    return this.setSettings({ [option]: enabled });
  }

  setSettings(settings: Partial<DisplayLabelSettings>): Readonly<DisplayLabelSettings> {
    this.current = mergeLabelSettings(this.current, settings);
    return this.current;
  }

  reset(): Readonly<DisplayLabelSettings> {
    this.current = DEFAULT_DISPLAY_LABEL_SETTINGS;
    return this.current;
  }
}

export type DisplayLabelKind =
  'nodeNumber' | 'memberNumber' | 'planeNumber' | 'section' | 'floorDirection' | 'weight' | 'storyHeight' | 'localAxis';

export interface DisplayLabelDescriptor {
  readonly kind: DisplayLabelKind;
  readonly text: string;
  readonly position: Point3D;
  readonly data?: DocumentData;
  readonly lowerLayer?: Layer;
  readonly upperLayer?: Layer;
  readonly value?: string | number;
  readonly axis?: 'x' | 'y' | 'z';
  readonly direction?: Point3D;
}

/** 要素ラベルと階高ラベルを、描画方法に依存しないdescriptorへ変換する。 */
export function createDisplayLabelDescriptors(
  data: ReadonlyArray<DocumentData>,
  layers: ReadonlyArray<Layer>,
  settings: Readonly<DisplayLabelSettings>,
  storyAnchor: Pick<Point3D, 'x' | 'y'> = Point3D.Zero,
): DisplayLabelDescriptor[] {
  return [
    ...createElementLabelDescriptors(data, settings),
    ...createStoryHeightLabelDescriptors(layers, settings, storyAnchor),
  ];
}

export function createElementLabelDescriptors(
  dataList: ReadonlyArray<DocumentData>,
  settings: Readonly<DisplayLabelSettings>,
): DisplayLabelDescriptor[] {
  const labels: DisplayLabelDescriptor[] = [];

  for (const data of dataList) {
    if (data instanceof Node) {
      if (settings.nodeNumber) labels.push(label('nodeNumber', `N${data.number}`, data.pos, data, data.number));
      continue;
    }

    if (data instanceof Member && data.ok) {
      const center = data.posI.add(data.posJ).div(2);
      if (settings.memberNumber) labels.push(label('memberNumber', `M${data.number}`, center, data, data.number));
      if (settings.section && data.section) labels.push(label('section', data.section, center, data, data.section));
      if (settings.localAxes) labels.push(...localAxisLabels(data, center, memberLocalFrame(data)));
      continue;
    }

    if (data instanceof Plane && data.ok) {
      const center = data.center;
      if (settings.planeNumber) labels.push(label('planeNumber', `P${data.number}`, center, data, data.number));
      if (settings.section && data.section) labels.push(label('section', data.section, center, data, data.section));
      if (settings.floorDirection && data instanceof Floor) {
        labels.push(label('floorDirection', data.direction, center, data, data.direction));
      }
      if (settings.weight && (data instanceof Floor || data instanceof Wall)) {
        labels.push(label('weight', `W=${formatNumber(data.weight)}`, center, data, data.weight));
      }
      if (settings.localAxes) {
        const frame = planeLocalFrame(data);
        if (frame) labels.push(...localAxisLabels(data, center, frame));
      }
    }
  }
  return labels;
}

export function createStoryHeightLabelDescriptors(
  layers: ReadonlyArray<Layer>,
  settings: Pick<DisplayLabelSettings, 'storyHeight'>,
  anchor: Pick<Point3D, 'x' | 'y'> = Point3D.Zero,
): DisplayLabelDescriptor[] {
  if (!settings.storyHeight || layers.length < 2) return [];
  const sorted = [...layers].sort((a, b) => a.posZ - b.posZ);
  const labels: DisplayLabelDescriptor[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i];
    const upper = sorted[i + 1];
    const height = upper.posZ - lower.posZ;
    labels.push({
      kind: 'storyHeight',
      text: `H=${formatNumber(height)}`,
      position: new Point3D(anchor.x, anchor.y, (lower.posZ + upper.posZ) / 2),
      lowerLayer: lower,
      upperLayer: upper,
      value: height,
      direction: Point3D.ZDirection.clone(),
    });
  }
  return labels;
}

interface LocalFrame {
  x: Point3D;
  y: Point3D;
  z: Point3D;
}

function memberLocalFrame(member: Member): LocalFrame {
  const geometricX = member.posJ.sub(member.posI).getNormalized();
  const requestedX = member instanceof Spring && member.orientX ? member.orientX.getNormalized() : geometricX;
  // 零長ばねは幾何軸を持たない。orientXが省略された有効モデルでも
  // local-axis表示がゼロベクトルにならないようglobal Xを既定軸にする。
  const x = requestedX.length > Number.EPSILON ? requestedX : Point3D.XDirection.clone();
  if (member instanceof Spring && member.orientY) {
    const projectedY = member.orientY.sub(x.scale(Point3D.dotProduct(member.orientY, x)));
    if (projectedY.length > Number.EPSILON) {
      const y = projectedY.getNormalized();
      return { x, y, z: Point3D.crossProduct(x, y).getNormalized() };
    }
  }
  const reference = Math.abs(Point3D.dotProduct(x, Point3D.ZDirection)) < 0.9 ? Point3D.ZDirection : Point3D.YDirection;
  const y = Point3D.crossProduct(reference, x).getNormalized();
  const z = Point3D.crossProduct(x, y).getNormalized();
  return { x, y, z };
}

function planeLocalFrame(plane: Plane): LocalFrame | null {
  const points = plane.nodeList.map((node) => node.pos);
  const origin = points[0];
  const x = points
    .slice(1)
    .map((point) => point.sub(origin))
    .find((edge) => edge.length > 0)
    ?.getNormalized();
  if (!x) return null;
  for (let i = 1; i < points.length - 1; i++) {
    const edge = points[i + 1].sub(origin);
    const z = Point3D.crossProduct(x, edge).getNormalized();
    if (z.length === 0) continue;
    const y = Point3D.crossProduct(z, x).getNormalized();
    return { x, y, z };
  }
  return null;
}

function localAxisLabels(data: DocumentData, position: Point3D, frame: LocalFrame): DisplayLabelDescriptor[] {
  return (['x', 'y', 'z'] as const).map((axis) => ({
    kind: 'localAxis',
    text: axis,
    position: position.clone(),
    data,
    axis,
    direction: frame[axis].clone(),
  }));
}

function label(
  kind: DisplayLabelKind,
  text: string,
  position: Point3D,
  data: DocumentData,
  value: string | number,
): DisplayLabelDescriptor {
  return { kind, text, position: position.clone(), data, value };
}

function mergeLabelSettings(
  base: Readonly<DisplayLabelSettings>,
  patch: Partial<DisplayLabelSettings>,
): Readonly<DisplayLabelSettings> {
  const next = { ...base };
  for (const option of DISPLAY_LABEL_OPTIONS) {
    const value = patch[option];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new TypeError(`Display label setting '${option}' must be a boolean`);
    next[option] = value;
  }
  return Object.freeze(next);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : Number(value.toFixed(6)).toString();
}
