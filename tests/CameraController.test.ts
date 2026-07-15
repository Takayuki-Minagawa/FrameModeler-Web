import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/ui/CameraController';

const rect = { left: 0, top: 0, width: 1000, height: 1000 } as DOMRect;

describe('CameraController work plane and fitting', () => {
  it('intersects the forward work plane in 2D', () => {
    const camera = new CameraController(
      () => 1,
      () => 1000,
    );
    const point = camera.screenToWorld(500, 500, 200, rect);
    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(0);
    expect(point?.y).toBeCloseTo(0);
    expect(point?.z).toBe(200);
    expect(camera.lastScreenToWorldError).toBeNull();
  });

  it('rejects a ray parallel to the work plane', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );
    controller.show3D = true;
    controller.camera.position.set(0, 0, 10);
    controller.camera.up.set(0, 0, 1);
    controller.camera.lookAt(10, 0, 10);
    controller.camera.updateMatrixWorld(true);

    expect(controller.screenToWorld(500, 500, 0, rect)).toBeNull();
    expect(controller.lastScreenToWorldError).toBe('parallel');
  });

  it('rejects a work plane behind the camera', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );
    controller.show3D = true;
    controller.camera.position.set(0, 0, 10);
    controller.camera.up.set(0, 1, 0);
    controller.camera.lookAt(0, 0, 20);
    controller.camera.updateMatrixWorld(true);

    expect(controller.screenToWorld(500, 500, 0, rect)).toBeNull();
    expect(controller.lastScreenToWorldError).toBe('behind');
  });

  it('guards a zero-sized viewport', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );
    const zeroRect = { left: 0, top: 0, width: 0, height: 0 } as DOMRect;
    expect(controller.screenToWorld(0, 0, 0, zeroRect)).toBeNull();
    expect(controller.lastScreenToWorldError).toBe('viewport-unavailable');
  });

  it('fits both center and distance to the model bounding box', () => {
    const controller = new CameraController(
      () => 2,
      () => 500,
    );
    const bounds = new THREE.Box3(new THREE.Vector3(1000, 2000, 0), new THREE.Vector3(3000, 3000, 400));
    controller.fitToBounds(bounds);

    expect(controller.cameraCenter.toArray()).toEqual([2000, 2500, 200]);
    expect(controller.cameraDistance).toBeCloseTo(575);
  });

  it('moves 2D grid bounds with the camera center', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );
    controller.fitToScene({ x: 10_000, y: -4_000, z: 0 } as never);
    const bounds = controller.getGridBounds(0, rect);
    expect(bounds.minX).toBeCloseTo(8_000);
    expect(bounds.maxX).toBeCloseTo(12_000);
    expect(bounds.minY).toBeCloseTo(-6_000);
    expect(bounds.maxY).toBeCloseTo(-2_000);
  });

  it('keeps an upper 2D work plane in front of the camera', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );
    controller.set2DWorkPlaneElevation(6000);
    const point = controller.screenToWorld(500, 500, 6000, rect);
    expect(point?.z).toBe(6000);
    expect(controller.lastScreenToWorldError).toBeNull();
  });

  it('keeps the top of a tall vertical element in front without changing plan zoom', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );
    const distance = controller.cameraDistance;
    controller.setSceneBounds(new THREE.Box3(new THREE.Vector3(-100, -100, 0), new THREE.Vector3(100, 100, 6000)));
    controller.set2DWorkPlaneElevation(0);
    expect(controller.cameraDistance).toBe(distance);
    expect(controller.worldToScreen(new THREE.Vector3(0, 0, 6000), rect)).not.toBeNull();
  });

  it('provides top/front/right standard orthographic views with predictable Z-up screen axes', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );

    controller.setStandardView('top');
    expect(controller.standardView).toBe('top');
    expect(viewOffset(controller)).toEqual([0, 0, 1]);
    expect(controller.camera.up.toArray()).toEqual([0, 1, 0]);

    controller.setStandardView('front');
    expect(controller.show3D).toBe(false);
    expect(controller.standardView).toBe('front');
    expect(viewOffset(controller)).toEqual([0, -1, 0]);
    expect(controller.camera.up.toArray()).toEqual([0, 0, 1]);
    const frontCenter = controller.worldToScreen(new THREE.Vector3(0, 0, 0), rect)!;
    const frontX = controller.worldToScreen(new THREE.Vector3(100, 0, 0), rect)!;
    const frontZ = controller.worldToScreen(new THREE.Vector3(0, 0, 100), rect)!;
    expect(frontX.x).toBeGreaterThan(frontCenter.x);
    expect(frontZ.y).toBeLessThan(frontCenter.y);

    controller.setStandardView('right');
    expect(controller.standardView).toBe('right');
    expect(viewOffset(controller)).toEqual([1, 0, 0]);
    expect(controller.camera.up.toArray()).toEqual([0, 0, 1]);
    const rightCenter = controller.worldToScreen(new THREE.Vector3(0, 0, 0), rect)!;
    const rightY = controller.worldToScreen(new THREE.Vector3(0, 100, 0), rect)!;
    const rightZ = controller.worldToScreen(new THREE.Vector3(0, 0, 100), rect)!;
    expect(rightY.x).toBeGreaterThan(rightCenter.x);
    expect(rightZ.y).toBeLessThan(rightCenter.y);
  });

  it('uses a true (+X,+Y,+Z) isometric direction and leaves it only after manual rotation', () => {
    const controller = new CameraController(
      () => 1,
      () => 1000,
    );
    controller.setStandardView('isometric');

    expect(controller.show3D).toBe(true);
    expect(controller.standardView).toBe('isometric');
    const offset = viewOffset(controller);
    expect(offset[0]).toBeCloseTo(1 / Math.sqrt(3));
    expect(offset[1]).toBeCloseTo(1 / Math.sqrt(3));
    expect(offset[2]).toBeCloseTo(1 / Math.sqrt(3));
    expect(controller.camera.up.toArray()).toEqual([0, 0, 1]);

    controller.fitToBounds(new THREE.Box3(new THREE.Vector3(-1000, -500, 0), new THREE.Vector3(3000, 1500, 2000)));
    expect(controller.cameraCenter.toArray()).toEqual([1000, 500, 1000]);
    expect(controller.standardView).toBe('isometric');
    const fittedOffset = viewOffset(controller);
    expect(fittedOffset[0]).toBeCloseTo(1 / Math.sqrt(3));
    expect(fittedOffset[1]).toBeCloseTo(1 / Math.sqrt(3));
    expect(fittedOffset[2]).toBeCloseTo(1 / Math.sqrt(3));

    controller.rotate(1, 0);
    expect(controller.standardView).toBeNull();
    expect(controller.camera.up.toArray()).toEqual([0, 0, 1]);
  });

  it('fits front-view X/Z extents without changing its orientation', () => {
    const controller = new CameraController(
      () => 2,
      () => 1000,
    );
    controller.setStandardView('front');
    controller.fitToBounds(new THREE.Box3(new THREE.Vector3(1000, -50, 200), new THREE.Vector3(3000, 50, 4200)));

    expect(controller.cameraCenter.toArray()).toEqual([2000, 0, 2200]);
    expect(controller.cameraDistance).toBeCloseTo(2300);
    expect(controller.standardView).toBe('front');
    expect(viewOffset(controller)).toEqual([0, -1, 0]);

    controller.set2DWorkPlaneElevation(9000);
    expect(controller.cameraCenter.z).toBe(2200);
  });
});

function viewOffset(controller: CameraController): [number, number, number] {
  const offset = controller.camera.position.clone().sub(controller.cameraCenter).normalize();
  return [cleanZero(offset.x), cleanZero(offset.y), cleanZero(offset.z)];
}

function cleanZero(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}
