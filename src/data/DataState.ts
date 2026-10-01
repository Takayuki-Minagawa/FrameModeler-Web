import { Point3D } from '../math/Point3D';

/**
 * 各DocumentData型が持つ可変フィールドの独立したコピー。
 * transaction rollback、変更検出、複製時の等価判定で共有する。
 * number / select はDocumentが別管理するため含めない。
 */
export type DataState = Readonly<Record<string, unknown>>;

/**
 * DataStateの値を構造的に比較する。
 * Point3D・配列・plain objectは内容で、Nodeなどのクラスインスタンスは同一性で比較する。
 */
export function stateValuesEqual(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (first instanceof Point3D && second instanceof Point3D) {
    return first.x === second.x && first.y === second.y && first.z === second.z;
  }
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((value, index) => stateValuesEqual(value, second[index]));
  }
  if (isPlainObject(first) && isPlainObject(second)) {
    const firstKeys = Object.keys(first);
    const secondKeys = Object.keys(second);
    return (
      firstKeys.length === secondKeys.length &&
      firstKeys.every((key) => key in second && stateValuesEqual(first[key], second[key]))
    );
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
