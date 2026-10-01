import type { Document } from '../data/Document';
import { t } from '../i18n';
import { pointFromDistanceAndAngle } from '../math/PlanInput';
import { Point3D } from '../math/Point3D';
import type { CadView } from '../ui/CadView';

export interface CoordinateEntryElements {
  x: HTMLInputElement;
  y: HTMLInputElement;
  z: HTMLInputElement;
  commit: HTMLButtonElement;
  distance: HTMLInputElement;
  angle: HTMLInputElement;
  polarCommit: HTMLButtonElement;
}

/** X/Y/Z と距離・角度の数値入力を、現在のツールへクリックと同じ経路で渡す。 */
export class CoordinateEntryController {
  constructor(
    private readonly cadView: CadView,
    private readonly document: Document,
    private readonly elements: CoordinateEntryElements,
  ) {}

  connect(): void {
    const { x, y, z, commit, distance, angle, polarCommit } = this.elements;
    commit.addEventListener('click', () => this.commitCoordinate());
    bindEnter([x, y, z], () => this.commitCoordinate());
    polarCommit.addEventListener('click', () => this.commitDistanceAndAngle());
    bindEnter([distance, angle], () => this.commitDistanceAndAngle());
  }

  commitCoordinate(): void {
    const inputs = [this.elements.x, this.elements.y, this.elements.z];
    const values = inputs.map((input) => input.valueAsNumber);
    const invalid = inputs.find((_, index) => !Number.isFinite(values[index]));
    if (invalid) {
      invalid.setCustomValidity(t('validation.finiteNumber'));
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    inputs.forEach((input) => input.setCustomValidity(''));
    this.sendPoint(new Point3D(values[0], values[1], values[2]));
  }

  commitDistanceAndAngle(): void {
    const { x, y, z, distance, angle } = this.elements;
    const anchor = this.cadView.constraintAnchor;
    if (!anchor) {
      alert(t('msg.firstPointRequired'));
      return;
    }
    try {
      const result = pointFromDistanceAndAngle({
        anchor,
        distance: distance.valueAsNumber,
        angleDegrees: angle.valueAsNumber,
        workPlaneZ: this.document.shownLayer?.posZ ?? anchor.z,
      });
      x.value = String(result.position.x);
      y.value = String(result.position.y);
      z.value = String(result.position.z);
      angle.value = String(result.angleDegrees);
      this.sendPoint(result.position);
    } catch (error) {
      distance.setCustomValidity((error as Error).message);
      distance.reportValidity();
    }
  }

  private sendPoint(position: Point3D): void {
    this.cadView.handler?.onClick(this.cadView, position, new MouseEvent('click'));
  }
}

function bindEnter(inputs: HTMLInputElement[], commit: () => void): void {
  for (const input of inputs) {
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit();
    });
  }
}
