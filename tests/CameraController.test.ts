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
});
