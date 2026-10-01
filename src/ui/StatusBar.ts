import type { Document } from '../data/Document';
import { t, type MessageKey } from '../i18n';
import type { Point3D } from '../math/Point3D';
import type { CadMeasurement, CadOperationStatus } from './CadView';
import type { WorkPlaneIntersectionError } from './CameraController';
import { getObjectSnapKindInfo, type ObjectSnapCandidateKind } from './ObjectSnapEngine';

export interface StatusBarElements {
  version: HTMLElement;
  coordinate: HTMLElement;
  info: HTMLElement;
}

const OPERATION_STATUS_KEYS: Record<CadOperationStatus, MessageKey> = {
  firstPointSelected: 'operation.firstPointSelected',
  noPointAbove: 'operation.noPointAbove',
  coincidentPoints: 'operation.coincidentPoints',
  duplicateElement: 'operation.duplicateElement',
};

/** 一時的な通知をステータスバーへ表示しておく時間。 */
const NOTICE_DURATION_MS = 8000;

/**
 * ステータスバーの表示状態を一元管理する。
 * 翻訳非依存のコードだけを保持し、文言は描画のたびに現在localeで組み立てる。
 */
export class StatusBar {
  private workPlaneError: WorkPlaneIntersectionError | null = null;
  private snapKind: ObjectSnapCandidateKind = 'none';
  private operationStatus: CadOperationStatus | null = null;
  private measurement: Readonly<CadMeasurement> | null = null;
  private selectedCount = 0;
  private dirty = false;
  /** 表示中に言語を切り替えても追随できるよう、文言ではなく生成関数を保持する。 */
  private notice: (() => string) | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly elements: StatusBarElements,
    private readonly document: Document,
    private readonly version: string,
  ) {}

  setCoordinate(position: Point3D): void {
    this.elements.coordinate.textContent = `(${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`;
  }

  setSnapKind(kind: ObjectSnapCandidateKind): void {
    this.snapKind = kind;
    this.refresh();
  }

  setOperationStatus(status: CadOperationStatus | null): void {
    this.operationStatus = status;
    this.refresh();
  }

  setWorkPlaneError(error: WorkPlaneIntersectionError | null): void {
    this.workPlaneError = error;
    this.refresh();
  }

  setMeasurement(measurement: Readonly<CadMeasurement> | null): void {
    this.measurement = measurement;
    this.refresh();
  }

  setSelectedCount(count: number): void {
    this.selectedCount = count;
    this.refresh();
  }

  setDirty(dirty: boolean): void {
    this.dirty = dirty;
    this.elements.version.textContent = `Ver.${this.version}${dirty ? ' *' : ''}`;
  }

  /** 操作結果などの短い通知を一定時間だけ表示する。 */
  showNotice(message: () => string): void {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.notice = message;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.notice = null;
      this.refresh();
    }, NOTICE_DURATION_MS);
    this.refresh();
  }

  /** 作業平面エラーの現在localeでの文言。canvasのtitleにも使う。 */
  get workPlaneMessage(): string {
    return this.workPlaneError ? t(`workPlane.${this.workPlaneError}`) : '';
  }

  refresh(): void {
    this.setDirty(this.dirty);
    const { nodeList, memberList, planeList } = this.document;
    const details = [
      this.notice?.() ?? '',
      this.operationStatus ? t(OPERATION_STATUS_KEYS[this.operationStatus]) : '',
      this.measurement ? formatMeasurement(this.measurement) : '',
      this.workPlaneMessage,
      this.snapKind === 'none' ? '' : `${t('snap')}: ${t(getObjectSnapKindInfo(this.snapKind).labelKey)}`,
    ]
      .filter(Boolean)
      .join(' / ');
    this.elements.info.textContent =
      `N:${nodeList.length} M:${memberList.length} P:${planeList.length} S:${this.selectedCount}` +
      (details ? ` — ${details}` : '');
  }
}

export function formatMeasurement(measurement: Readonly<CadMeasurement>): string {
  const delta = measurement.to.sub(measurement.from);
  return t('measure.result', {
    distance: formatLength(delta.length),
    dx: formatLength(delta.x),
    dy: formatLength(delta.y),
    dz: formatLength(delta.z),
  });
}

function formatLength(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}
