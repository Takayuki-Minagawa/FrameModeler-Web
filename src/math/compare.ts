/**
 * 数値ペアを順に比較する（z→y→x のような段階的辞書順比較用, D-5）。
 * 各ペア [a, b] を先頭から比較し、最初に差がついた符号を返す。全て等しければ 0。
 */
export function compareNumbers(...pairs: ReadonlyArray<readonly [number, number]>): number {
  for (const [a, b] of pairs) {
    if (a < b) return -1;
    if (a > b) return +1;
  }
  return 0;
}
