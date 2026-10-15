import { Point3D } from './Point3D';

/** 座標計算で保持する小数桁数。mm 単位のモデルでは 1e-6 mm 未満の差は意味を持たない。 */
export const COORDINATE_DECIMALS = 6;

/** 三角関数や線分補間で生じた浮動小数誤差を落とす。-0 は 0 に正規化する。 */
export function roundCoordinate(value: number, decimals: number = COORDINATE_DECIMALS): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 値を step 間隔の格子へ丸める。step が正の有限値でなければそのまま返す。 */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return roundCoordinate(Math.round(value / step) * step);
}

/** 各成分を roundCoordinate した新しい点を返す。 */
export function roundPoint(point: Point3D, decimals: number = COORDINATE_DECIMALS): Point3D {
  return new Point3D(
    roundCoordinate(point.x, decimals),
    roundCoordinate(point.y, decimals),
    roundCoordinate(point.z, decimals),
  );
}
