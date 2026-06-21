import { Document } from '../../data/Document';
import { Point3D } from '../../math/Point3D';

/** 2点を対角とする矩形の4頂点を返す（床用）。Zは2点の中点高さ。 */
export function createRectPoints(p: Point3D, q: Point3D): Point3D[] {
  const min = Point3D.min(p, q);
  const max = Point3D.max(p, q);
  const z = (min.z + max.z) / 2;
  return [
    new Point3D(min.x, min.y, z),
    new Point3D(max.x, min.y, z),
    new Point3D(max.x, max.y, z),
    new Point3D(min.x, max.y, z),
  ];
}

/** 下端2点とその直上点からなる四角形の4頂点を返す（壁/耐力壁用）。 */
export function createQuadPoints(p: Point3D, q: Point3D): { points: Point3D[]; aboveExists: boolean } {
  const doc = Document.instance;
  const aboveP = doc.getPosAbove(p);
  const aboveQ = doc.getPosAbove(q);

  const aboveExists = aboveP !== null && aboveQ !== null;
  return {
    points: [
      p,
      q,
      aboveQ ?? q,
      aboveP ?? p,
    ],
    aboveExists,
  };
}
