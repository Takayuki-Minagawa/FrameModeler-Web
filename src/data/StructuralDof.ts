/** 3D構造モデルの自由度順。質量・拘束・ばねで常にこの順を使用する。 */
export const STRUCTURAL_DOFS = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;

export type StructuralDof = (typeof STRUCTURAL_DOFS)[number];
export type DofVector6 = [number, number, number, number, number, number];

export interface NodeMass {
  /** [ux, uy, uz, rx, ry, rz]。並進3成分は質量、回転3成分は慣性。 */
  values: DofVector6;
  translationalUnit: string;
  rotationalUnit: string;
}

export function structuralDofIndex(dof: StructuralDof): number {
  return STRUCTURAL_DOFS.indexOf(dof);
}

/** OpenSees系の1始まりDOF番号を安定した名前へ変換する。 */
export function structuralDofFromOneBasedIndex(index: number): StructuralDof {
  if (!Number.isInteger(index) || index < 1 || index > STRUCTURAL_DOFS.length) {
    throw new RangeError(`Structural DOF index must be an integer from 1 to 6, got ${index}`);
  }
  return STRUCTURAL_DOFS[index - 1];
}

export function isStructuralDof(value: unknown): value is StructuralDof {
  return typeof value === 'string' && (STRUCTURAL_DOFS as readonly string[]).includes(value);
}

export function cloneDofVector(values: ReadonlyArray<number>): DofVector6 {
  if (values.length !== 6) throw new RangeError(`Expected 6 DOF values, got ${values.length}`);
  return [values[0], values[1], values[2], values[3], values[4], values[5]];
}

export function cloneNodeMass(mass: NodeMass | null): NodeMass | null {
  return mass
    ? {
        values: cloneDofVector(mass.values),
        translationalUnit: mass.translationalUnit,
        rotationalUnit: mass.rotationalUnit,
      }
    : null;
}
