import { Point3D } from './Point3D';

export type PlanInputErrorCode =
  | 'non-finite-anchor'
  | 'non-finite-distance'
  | 'negative-distance'
  | 'non-finite-angle'
  | 'non-finite-work-plane'
  | 'non-finite-result';

export class PlanInputError extends RangeError {
  constructor(
    readonly code: PlanInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlanInputError';
  }
}

export interface DistanceAngleInput {
  readonly anchor: Pick<Point3D, 'x' | 'y' | 'z'>;
  /** モデル単位（現行Documentではmm）。0は許可し、負値は拒否する。 */
  readonly distance: number;
  /** +Z側から見て+X=0°、+Y=90°となる反時計回り角度。 */
  readonly angleDegrees: number;
  /** 省略時はanchor.z。指定時もZ-up作業平面としてこの値へ固定する。 */
  readonly workPlaneZ?: number;
}

export interface DistanceAngleResult {
  readonly position: Point3D;
  readonly distance: number;
  /** [0, 360)へ正規化した角度。 */
  readonly angleDegrees: number;
  readonly angleRadians: number;
}

/** 有限な角度を[0, 360)へ正規化する。 */
export function normalizeAngleDegrees(angleDegrees: number): number {
  if (!Number.isFinite(angleDegrees)) {
    throw new PlanInputError('non-finite-angle', 'Angle must be finite');
  }
  const normalized = ((angleDegrees % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

/**
 * anchorから距離・角度で、Z-upのXY作業平面上に点を生成する。
 * UIやDocumentへ依存せず、検証済みの値と正規化角度を同時に返す。
 */
export function pointFromDistanceAndAngle(input: DistanceAngleInput): DistanceAngleResult {
  const { anchor } = input;
  if (![anchor.x, anchor.y, anchor.z].every(Number.isFinite)) {
    throw new PlanInputError('non-finite-anchor', 'Anchor coordinates must be finite');
  }
  if (!Number.isFinite(input.distance)) {
    throw new PlanInputError('non-finite-distance', 'Distance must be finite');
  }
  if (input.distance < 0) {
    throw new PlanInputError('negative-distance', 'Distance must not be negative');
  }

  const angleDegrees = normalizeAngleDegrees(input.angleDegrees);
  const workPlaneZ = input.workPlaneZ ?? anchor.z;
  if (!Number.isFinite(workPlaneZ)) {
    throw new PlanInputError('non-finite-work-plane', 'Work-plane elevation must be finite');
  }

  const distance = input.distance === 0 ? 0 : input.distance;
  const angleRadians = (angleDegrees * Math.PI) / 180;
  const position = new Point3D(
    anchor.x + distance * Math.cos(angleRadians),
    anchor.y + distance * Math.sin(angleRadians),
    workPlaneZ,
  );
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new PlanInputError('non-finite-result', 'Distance and anchor produce a non-finite coordinate');
  }

  return { position, distance, angleDegrees, angleRadians };
}
