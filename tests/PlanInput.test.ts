import { describe, expect, it } from 'vitest';
import { Point3D } from '../src/math/Point3D';
import { normalizeAngleDegrees, PlanInputError, pointFromDistanceAndAngle } from '../src/math/PlanInput';

describe('distance/angle plan input', () => {
  it('uses the right-handed Z-up convention on the requested work plane', () => {
    const result = pointFromDistanceAndAngle({
      anchor: new Point3D(100, 200, 300),
      distance: 50,
      angleDegrees: 90,
      workPlaneZ: 1200,
    });

    expect(result.position.x).toBeCloseTo(100);
    expect(result.position.y).toBeCloseTo(250);
    expect(result.position.z).toBe(1200);
    expect(result.angleDegrees).toBe(90);
    expect(result.angleRadians).toBeCloseTo(Math.PI / 2);
  });

  it('normalizes positive, negative, and full-turn angles into [0, 360)', () => {
    expect(normalizeAngleDegrees(450)).toBe(90);
    expect(normalizeAngleDegrees(-90)).toBe(270);
    expect(normalizeAngleDegrees(720)).toBe(0);

    const result = pointFromDistanceAndAngle({
      anchor: new Point3D(),
      distance: 10,
      angleDegrees: -90,
    });
    expect(result.position.x).toBeCloseTo(0);
    expect(result.position.y).toBeCloseTo(-10);
    expect(result.position.z).toBe(0);
  });

  it('allows zero distance but rejects a finite negative distance', () => {
    const zero = pointFromDistanceAndAngle({
      anchor: new Point3D(1, 2, 3),
      distance: 0,
      angleDegrees: 123,
    });
    expect(zero.position).toEqual(new Point3D(1, 2, 3));

    expect(() =>
      pointFromDistanceAndAngle({
        anchor: new Point3D(),
        distance: -0.1,
        angleDegrees: 0,
      }),
    ).toThrowError(expect.objectContaining<Partial<PlanInputError>>({ code: 'negative-distance' }));
  });

  it.each([
    [{ anchor: new Point3D(Number.NaN, 0, 0), distance: 1, angleDegrees: 0 }, 'non-finite-anchor'],
    [{ anchor: new Point3D(), distance: Number.POSITIVE_INFINITY, angleDegrees: 0 }, 'non-finite-distance'],
    [{ anchor: new Point3D(), distance: 1, angleDegrees: Number.NaN }, 'non-finite-angle'],
    [{ anchor: new Point3D(), distance: 1, angleDegrees: 0, workPlaneZ: Number.NaN }, 'non-finite-work-plane'],
  ] as const)('rejects invalid finite input with code %s', (input, code) => {
    expect(() => pointFromDistanceAndAngle(input)).toThrowError(
      expect.objectContaining<Partial<PlanInputError>>({ code }),
    );
  });

  it('rejects overflow even when every individual input is finite', () => {
    expect(() =>
      pointFromDistanceAndAngle({
        anchor: new Point3D(Number.MAX_VALUE, 0, 0),
        distance: Number.MAX_VALUE,
        angleDegrees: 0,
      }),
    ).toThrowError(expect.objectContaining<Partial<PlanInputError>>({ code: 'non-finite-result' }));
  });
});
