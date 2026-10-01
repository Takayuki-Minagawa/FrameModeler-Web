/** 必須要素を型付きで取得する。存在しなければ起動時に即座にエラーにする。 */
export function byId<T extends HTMLElement>(id: string, root: Document = document): T {
  const element = root.getElementById(id);
  if (!element) throw new Error(`Element not found: #${id}`);
  return element as T;
}
