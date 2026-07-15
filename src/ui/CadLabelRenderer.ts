import type { DisplayLabelDescriptor } from '../display/DisplayLabels';
import type { Point3D } from '../math/Point3D';

type ProjectPoint = (point: Point3D) => { x: number; y: number } | null;

/** Three.js canvas上へ要素情報をCSS pixelで重ねる軽量ラベルrenderer。 */
export class CadLabelRenderer {
  private readonly layer: HTMLDivElement | null;

  constructor(canvas: HTMLCanvasElement) {
    const ownerDocument = canvas.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    if (!ownerDocument) {
      this.layer = null;
      return;
    }
    this.layer = ownerDocument.createElement('div');
    this.layer.className = 'cad-label-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    canvas.parentElement?.appendChild(this.layer);
  }

  render(descriptors: ReadonlyArray<DisplayLabelDescriptor>, project: ProjectPoint): void {
    if (!this.layer) return;
    const fragment = this.layer.ownerDocument.createDocumentFragment();
    for (const descriptor of descriptors) {
      const position = project(descriptor.position);
      if (!position) continue;
      const label = this.layer.ownerDocument.createElement('span');
      label.className = `cad-label cad-label-${descriptor.kind}`;
      label.textContent = descriptor.text;
      label.style.left = `${position.x}px`;
      label.style.top = `${position.y}px`;

      if (descriptor.kind === 'localAxis' && descriptor.direction) {
        const tip = project(descriptor.position.add(descriptor.direction.scale(250)));
        if (!tip) continue;
        // x/y/zを原点へ重ねず、それぞれの正方向の先端へ配置する。
        label.style.left = `${tip.x}px`;
        label.style.top = `${tip.y}px`;
        label.dataset.axis = descriptor.axis;
      }
      fragment.appendChild(label);
    }
    this.layer.replaceChildren(fragment);
  }

  clear(): void {
    this.layer?.replaceChildren();
  }

  dispose(): void {
    this.layer?.remove();
  }
}
