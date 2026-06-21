import * as THREE from 'three';
import { Point3D } from '../math/Point3D';
import { CAD } from './CadConfig';

/**
 * カメラ専任クラス（V-2）。
 * ortho/persp カメラ、カメラ中心、距離、球面座標(3D視点)、show3D を所有し、
 * カメラ更新・視錐台計算・パン/回転/ズーム・screenToWorld を担う。
 * ロジックは CadView から無変更で移設。
 */
export class CameraController {
  private orthoCamera: THREE.OrthographicCamera;
  private perspCamera: THREE.PerspectiveCamera;
  private _camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;

  private _show3D = false;
  cameraCenter = new THREE.Vector3(0, 0, 0);
  cameraDistance = 2000;

  // 球面座標 (3D視点用)
  private spherePhi = Math.PI / 4;
  private sphereTheta = Math.PI / 4;

  /** Orthoカメラ視錐台計算に使うアスペクト比の供給元 */
  private getAspect: () => number;

  constructor(getAspect: () => number) {
    this.getAspect = getAspect;

    // カメラ
    this.orthoCamera = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, 1, 1000000);
    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 10, 1000000);
    this._camera = this.orthoCamera;

    // Z-up設定
    this.orthoCamera.up.set(0, 0, 1);
    this.perspCamera.up.set(0, 0, 1);

    // 初期カメラ位置(2D: Z方向から見下ろし)
    this.updateCamera();
  }

  /** アクティブカメラ */
  get camera(): THREE.OrthographicCamera | THREE.PerspectiveCamera { return this._camera; }

  get show3D(): boolean { return this._show3D; }
  set show3D(value: boolean) {
    this._show3D = value;
    this._camera = value ? this.perspCamera : this.orthoCamera;
    this.updateCamera();
  }

  updateCamera(): void {
    if (this._show3D) {
      const r = this.cameraDistance;
      const x = r * Math.sin(this.sphereTheta) * Math.cos(this.spherePhi);
      const y = r * Math.sin(this.sphereTheta) * Math.sin(this.spherePhi);
      const z = r * Math.cos(this.sphereTheta);
      this.perspCamera.position.set(
        this.cameraCenter.x + x,
        this.cameraCenter.y + y,
        this.cameraCenter.z + z
      );
      this.perspCamera.lookAt(this.cameraCenter);
      this.perspCamera.updateProjectionMatrix();
    } else {
      this.orthoCamera.position.set(
        this.cameraCenter.x,
        this.cameraCenter.y,
        this.cameraCenter.z + this.cameraDistance
      );
      this.orthoCamera.lookAt(this.cameraCenter);
      // 2Dは真上(+Z)から見下ろすため、画面上方向を+Yに固定する
      // （3D用のZ-up設定とは別。平面図の向きを安定させる意図）
      this.orthoCamera.up.set(0, 1, 0);
      this.updateOrthoFrustum();
    }
  }

  /** Orthoカメラの視錐台をコンテナのアスペクト比に合わせて更新する（V-8） */
  updateOrthoFrustum(): void {
    const aspect = this.getAspect();
    const halfH = this.cameraDistance;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  /** リサイズ時のカメラ更新（ortho 視錐台 + persp アスペクト） */
  resize(aspect: number): void {
    this.updateOrthoFrustum();

    // Perspカメラ更新
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
  }

  /** シーン中心にカメラを合わせる */
  fitToScene(center: Point3D): void {
    this.cameraCenter.set(center.x, center.y, center.z);
    this.updateCamera();
  }

  /** パン（マウス移動量 dx,dy / px） */
  pan(dx: number, dy: number): void {
    const scale = this.cameraDistance / CAD.PAN_DENOM;
    this.cameraCenter.x -= dx * scale;
    this.cameraCenter.y += dy * scale;
    this.updateCamera();
  }

  /** 3D回転（マウス移動量 dx,dy / px） */
  rotate(dx: number, dy: number): void {
    this.spherePhi -= dx * CAD.ROTATE_SENSITIVITY;
    this.sphereTheta += dy * CAD.ROTATE_SENSITIVITY;
    this.sphereTheta = Math.max(0.01, Math.min(Math.PI - 0.01, this.sphereTheta));
    this.updateCamera();
  }

  /** ホイールズーム */
  zoom(deltaY: number): void {
    const ratio = deltaY > 0 ? CAD.ZOOM_FACTOR : 1 / CAD.ZOOM_FACTOR;
    this.cameraDistance *= ratio;
    this.cameraDistance = Math.max(CAD.MIN_DISTANCE, Math.min(CAD.MAX_DISTANCE, this.cameraDistance));
    this.updateCamera();
  }

  /** NDC→ワールド座標。layerZ は呼び出し側から受け取る。 */
  screenToWorld(screenX: number, screenY: number, layerZ: number, rect: DOMRect): Point3D {
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

    const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
    ndc.unproject(this._camera);

    if (!this._show3D) {
      return new Point3D(ndc.x, ndc.y, layerZ);
    } else {
      const camPos = this._camera.position.clone();
      const dir = ndc.sub(camPos).normalize();
      if (Math.abs(dir.z) < 0.0001) return new Point3D(ndc.x, ndc.y, layerZ);
      const t = (layerZ - camPos.z) / dir.z;
      return new Point3D(camPos.x + dir.x * t, camPos.y + dir.y * t, layerZ);
    }
  }
}
