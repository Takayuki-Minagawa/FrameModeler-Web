import type { Document } from '../data/Document';
import type { DocumentData } from '../data/DocumentData';
import { ModelValidationError } from '../data/ModelValidator';
import { kindLabel, t, type MessageKey } from '../i18n';

export interface ModelErrorDescription {
  /** 現在の言語での利用者向け説明。 */
  message: string;
  /** エラーの原因となった要素。ハイライト用。 */
  targets: DocumentData[];
}

const REASON_KEYS: ReadonlyArray<[test: (detail: string) => boolean, key: MessageKey]> = [
  [(d) => d.startsWith('non-planar vertex'), 'modelError.nonPlanar'],
  [(d) => d.includes('self-intersect'), 'modelError.selfIntersecting'],
  [(d) => d.startsWith('plane area must'), 'modelError.degeneratePlane'],
  [(d) => d === 'plane vertices are collinear', 'modelError.collinear'],
  [(d) => d === 'duplicate vertex coordinate', 'modelError.duplicateVertex'],
  [
    (d) => d.startsWith('member length must') || d === 'member endpoints must be different nodes',
    'modelError.zeroLength',
  ],
];

/**
 * 内部形式の検証エラー (`data[16].nodes[3]: non-planar vertex ...`) を、
 * 要素種別・番号と理由からなる現在の言語の文言へ変換する。
 */
export function describeModelError(error: unknown, doc: Document): ModelErrorDescription {
  if (!(error instanceof ModelValidationError)) {
    return { message: error instanceof Error ? error.message : String(error), targets: [] };
  }
  // 追加時の検証は候補リストに対して行われ index が Document の並びとずれるため、要素そのものを優先する。
  const match = /^data\[(\d+)\]/.exec(error.path);
  const target = error.target ?? (match ? doc.allDataList[Number(match[1])] : undefined);
  const reasonKey = REASON_KEYS.find(([test]) => test(error.detail))?.[1];
  if (target) {
    const subject = `${kindLabel(target.kind)} ${target.number}`;
    const message = reasonKey
      ? t(reasonKey, { element: subject })
      : t('modelError.generic', { element: subject, detail: error.detail });
    return { message, targets: [target] };
  }
  return { message: reasonKey ? t(reasonKey, { element: t('modelError.model') }) : error.message, targets: [] };
}
