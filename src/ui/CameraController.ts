import * as THREE from 'three';
import { Point3D } from '../math/Point3D';
import { CAD } from './CadConfig';

export type WorkPlaneIntersectionError = 'viewport-unavailable' | 'parallel' | 'behind';

export interface GridBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 2D/3Dカメラ、投影、作業平面との交差を一元管理する。
 * 画面座標はCSS pixel、モデル座標はmmとして扱う。
 */
export class CameraController {
  private readonly orthoCamera: THREE.OrthographicCamera;
  private readonly perspCamera: THREE.PerspectiveCamera;
  private _camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;

  private _show3D = false;
  readonly cameraCenter = new THREE.Vector3(0, 0, 0);
  cameraDistance = 2000;

  private spherePhi = Math.PI / 4;
  private sphereTheta = Math.PI / 4;
  private sceneRadius = 1000;
  private _lastScreenToWorldError: WorkPlaneIntersectionError | null = null;

  constructor(
    private readonly getAspect: () => number,
    private readonly getViewportHeight: () => number = () => CAD.PAN_DENOM * 2,
  ) {
    this.orthoCamera = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 1000000);
    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000000);
    this._camera = this.orthoCamera;

    this.orthoCamera.up.set(0, 0, 1);
    this.perspCamera.up.set(0, 0, 1);
    this.updateCamera();
  }

  get camera(): THREE.OrthographicCamera | THREE.PerspectiveCamera {
    return this._camera;
  }

  get show3D(): boolean {
    return this._show3D;
  }
  set show3D(value: boolean) {
    if (this._show3D === value) return;
    this._show3D = value;
    this._camera = value ? this.perspCamera : this.orthoCamera;
    this.updateCamera();
  }

  get lastScreenToWorldError(): WorkPlaneIntersectionError | null {
    return this._lastScreenToWorldError;
  }

  updateCamera(): void {
    if (this._show3D) {
      const r = this.cameraDistance;
      const x = r * Math.sin(this.sphereTheta) * Math.cos(this.spherePhi);
      const y = r * Math.sin(this.sphereTheta) * Math.sin(this.spherePhi);
      const z = r * Math.cos(this.sphereTheta);
      this.perspCamera.position.set(this.cameraCenter.x + x, this.cameraCenter.y + y, this.cameraCenter.z + z);
      this.perspCamera.up.set(0, 0, 1);
      this.perspCamera.lookAt(this.cameraCenter);
    } else {
      this.orthoCamera.position.set(
        this.cameraCenter.x,
        this.cameraCenter.y,
        this.cameraCenter.z + this.orthoElevation,
      );
      // 平面図では画面上方向を常に+Yにする。
      this.orthoCamera.up.set(0, 1, 0);
      this.orthoCamera.lookAt(this.cameraCenter);
      this.updateOrthoFrustum();
    }

    this.updateClippingPlanes();
    this._camera.updateProjectionMatrix();
    this._camera.updateMatrixWorld(true);
  }

  updateOrthoFrustum(): void {
    const aspect = this.safeAspect();
    const halfH = this.cameraDistance;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.updateOrthoFrustum();
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
    this._camera.updateMatrixWorld(true);
  }

  /** 中心だけを合わせる従来API。モデル全体fitにはfitToBoundsを使う。 */
  fitToScene(center: Point3D): void {
    this.cameraCenter.set(center.x, center.y, center.z);
    this.updateCamera();
  }

  /** モデルのBox3が2D/3Dの視錐台へ収まるよう中心・距離・near/farを更新する。 */
  fitToBounds(bounds: THREE.Box3): void {
    if (bounds.isEmpty()) {
      this.cameraCenter.set(0, 0, 0);
      this.sceneRadius = CAD.MIN_DISTANCE;
      this.cameraDistance = Math.max(this.cameraDistance, CAD.MIN_DISTANCE);
      this.updateCamera();
      return;
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    this.cameraCenter.copy(center);
    this.sceneRadius = Math.max(size.length() / 2, CAD.MIN_DISTANCE);

    if (this._show3D) {
      const verticalHalfFov = THREE.MathUtils.degToRad(this.perspCamera.fov) / 2;
      const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * this.safeAspect());
      const limitingHalfFov = Math.max(0.01, Math.min(verticalHalfFov, horizontalHalfFov));
      this.cameraDistance = (this.sceneRadius / Math.sin(limitingHalfFov)) * CAD.FIT_PADDING;
    } else {
      const halfX = size.x / (2 * this.safeAspect());
      const halfY = size.y / 2;
      this.cameraDistance = Math.max(halfX, halfY, CAD.MIN_DISTANCE) * CAD.FIT_PADDING;
    }

    this.cameraDistance = clampDistance(this.cameraDistance);
    this.updateCamera();
  }

  /** 平面図カメラを現在レイヤーの直上へ置き、上層でも作業平面を前方に保つ。 */
  set2DWorkPlaneElevation(layerZ: number): void {
    if (this._show3D || this.cameraCenter.z === layerZ) return;
    this.cameraCenter.z = layerZ;
    this.updateCamera();
  }

  /** zoomを変えずに、2Dカメラ高とclippingへモデル全体のZ範囲を反映する。 */
  setSceneBounds(bounds: THREE.Box3): void {
    this.sceneRadius = bounds.isEmpty()
      ? Math.max(this.sceneRadius, CAD.MIN_DISTANCE)
      : Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, CAD.MIN_DISTANCE);
    this.updateCamera();
  }

  /** CSS pixel量をカメラのright/up基底へ変換してパンする。 */
  pan(dx: number, dy: number): void {
    this._camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(this._camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(this._camera.matrixWorld, 1).normalize();
    const scale = this.worldUnitsPerPixelAt(this.cameraCenter);
    this.cameraCenter.addScaledVector(right, -dx * scale);
    this.cameraCenter.addScaledVector(up, dy * scale);
    this.updateCamera();
  }

  rotate(dx: number, dy: number): void {
    this.spherePhi -= dx * CAD.ROTATE_SENSITIVITY;
    this.sphereTheta += dy * CAD.ROTATE_SENSITIVITY;
    this.sphereTheta = Math.max(0.01, Math.min(Math.PI - 0.01, this.sphereTheta));
    this.updateCamera();
  }

  zoom(deltaY: number): void {
    const ratio = deltaY > 0 ? CAD.ZOOM_FACTOR : 1 / CAD.ZOOM_FACTOR;
    this.cameraDistance = clampDistance(this.cameraDistance * ratio);
    this.updateCamera();
  }

  /**
   * 画面位置からZ=layerZ作業平面への前方交点を返す。
   * 平行、カメラ後方、0サイズviewportではnullを返す。
   */
  screenToWorld(screenX: number, screenY: number, layerZ: number, rect: DOMRect): Point3D | null {
    const raycaster = new THREE.Raycaster();
    if (!this.setRayFromScreen(raycaster, screenX, screenY, rect)) {
      this._lastScreenToWorldError = 'viewport-unavailable';
      return null;
    }

    const { origin, direction } = raycaster.ray;
    if (Math.abs(direction.z) <= 1e-10) {
      this._lastScreenToWorldError = 'parallel';
      return null;
    }

    const distance = (layerZ - origin.z) / direction.z;
    if (!Number.isFinite(distance) || distance < 0) {
      this._lastScreenToWorldError = 'behind';
      return null;
    }

    const hit = raycaster.ray.at(distance, new THREE.Vector3());
    this._lastScreenToWorldError = null;
    return new Point3D(hit.x, hit.y, layerZ);
  }

  /** RaycasterをCSS pixel位置から設定する。 */
  setRayFromScreen(
    raycaster: THREE.Raycaster,
    screenX: number,
    screenY: number,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  ): boolean {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const ndc = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1,
    );
    this._camera.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, this._camera);
    return true;
  }

  /** ワールド点をCSS pixelへ投影する。カメラ後方ならnull。 */
  worldToScreen(
    point: Point3D | THREE.Vector3,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  ): THREE.Vector2 | null {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const world = new THREE.Vector3(point.x, point.y, point.z);
    const cameraSpace = world.clone().applyMatrix4(this._camera.matrixWorldInverse);
    if (cameraSpace.z >= 0) return null;
    const projected = world.project(this._camera);
    return new THREE.Vector2(
      rect.left + ((projected.x + 1) * rect.width) / 2,
      rect.top + ((1 - projected.y) * rect.height) / 2,
    );
  }

  /** 指定深度で1 CSS pixelに相当するworld距離。 */
  worldUnitsPerPixelAt(point: Point3D | THREE.Vector3): number {
    const height = Math.max(1, this.getViewportHeight());
    if (!this._show3D) return (2 * this.cameraDistance) / height;
    const distance = this._camera.position.distanceTo(new THREE.Vector3(point.x, point.y, point.z));
    const halfFov = THREE.MathUtils.degToRad(this.perspCamera.fov) / 2;
    return (2 * Math.max(distance, 1) * Math.tan(halfFov)) / height;
  }

  /** 現在viewportから作業平面上に必要なグリッド範囲を算出する。 */
  getGridBounds(layerZ: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): GridBounds {
    if (!this._show3D) {
      const halfY = this.cameraDistance;
      const halfX = halfY * this.safeAspect();
      return {
        minX: this.cameraCenter.x - halfX,
        maxX: this.cameraCenter.x + halfX,
        minY: this.cameraCenter.y - halfY,
        maxY: this.cameraCenter.y + halfY,
      };
    }

    const hits: THREE.Vector3[] = [];
    const raycaster = new THREE.Raycaster();
    for (const [x, y] of [
      [rect.left, rect.top],
      [rect.left + rect.width, rect.top],
      [rect.left + rect.width, rect.top + rect.height],
      [rect.left, rect.top + rect.height],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ] as const) {
      if (!this.setRayFromScreen(raycaster, x, y, rect)) continue;
      const dz = raycaster.ray.direction.z;
      if (Math.abs(dz) <= 1e-10) continue;
      const t = (layerZ - raycaster.ray.origin.z) / dz;
      if (t >= 0 && Number.isFinite(t)) hits.push(raycaster.ray.at(t, new THREE.Vector3()));
    }

    const maxRange = this.cameraDistance * CAD.GRID_RANGE_RATIO;
    if (hits.length === 0) {
      return {
        minX: this.cameraCenter.x - maxRange,
        maxX: this.cameraCenter.x + maxRange,
        minY: this.cameraCenter.y - maxRange,
        maxY: this.cameraCenter.y + maxRange,
      };
    }

    const box = new THREE.Box3().setFromPoints(hits);
    const minX = Math.max(box.min.x, this.cameraCenter.x - maxRange);
    const maxX = Math.min(box.max.x, this.cameraCenter.x + maxRange);
    const minY = Math.max(box.min.y, this.cameraCenter.y - maxRange);
    const maxY = Math.min(box.max.y, this.cameraCenter.y + maxRange);
    return {
      minX: minX === maxX ? minX - maxRange : minX,
      maxX: minX === maxX ? maxX + maxRange : maxX,
      minY: minY === maxY ? minY - maxRange : minY,
      maxY: minY === maxY ? maxY + maxRange : maxY,
    };
  }

  private safeAspect(): number {
    const aspect = this.getAspect();
    return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  }

  private updateClippingPlanes(): void {
    const radius = Math.max(this.sceneRadius, this.cameraDistance * 0.01, 1);
    const near = Math.max(0.1, this.cameraDistance - radius * 2);
    const far = Math.max(near + 1, this.cameraDistance + radius * 2, this.cameraDistance * 4);
    this.perspCamera.near = near;
    this.perspCamera.far = far;
    this.orthoCamera.near = 0.1;
    this.orthoCamera.far = Math.max(1, this.orthoElevation + radius * 2);
  }

  private get orthoElevation(): number {
    return Math.max(this.cameraDistance, this.sceneRadius * 2 + 1);
  }
}

function clampDistance(distance: number): number {
  return Math.max(CAD.MIN_DISTANCE, Math.min(CAD.MAX_DISTANCE, distance));
}
