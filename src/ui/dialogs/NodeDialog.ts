import { Document } from '../../data/Document';
import { Node } from '../../data/Node';
import { STRUCTURAL_DOFS, type DofVector6, type NodeMass } from '../../data/StructuralDof';
import { t } from '../../i18n';
import { Point3D } from '../../math/Point3D';
import {
  addButtonRow,
  addFormRow,
  createDialogBox,
  createModalOverlay,
  readFiniteNumber,
  wireDialog,
} from './DialogUtil';
import {
  addCheckboxRow,
  addStructuralFieldset,
  dofLabel,
  readRequiredText,
  readValidatedNumber,
  setInputsEnabled,
} from './StructuralDialogUtil';

/** Commandへ渡すNodeプロパティの完全スナップショット。 */
export interface NodeDialogResult {
  pos: Point3D;
  mass: NodeMass | null;
}

/** Node位置と6自由度の節点質量・回転慣性を編集する。モデル自体は変更しない。 */
export async function showNodeDialog(node: Node): Promise<NodeDialogResult | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t('dialog.nodeProps'));
  box.classList.add('wide-dialog');

  const inputX = addFormRow(box, 'X [mm]', 'number', String(node.pos.x));
  const inputY = addFormRow(box, 'Y [mm]', 'number', String(node.pos.y));
  const inputZ = addFormRow(box, 'Z [mm]', 'number', String(node.pos.z));

  const massFieldset = addStructuralFieldset(box, t('structural.nodeMass'));
  const massEnabled = addCheckboxRow(massFieldset, t('structural.enableMass'), node.mass !== null);
  const massInputs = STRUCTURAL_DOFS.map((dof, index) =>
    addFormRow(massFieldset, dofLabel(dof), 'number', String(node.mass?.values[index] ?? 0)),
  );
  const translationalUnit = addFormRow(
    massFieldset,
    t('structural.translationalMassUnit'),
    'text',
    node.mass?.translationalUnit ?? 'N*s^2/mm',
  );
  const rotationalUnit = addFormRow(
    massFieldset,
    t('structural.rotationalInertiaUnit'),
    'text',
    node.mass?.rotationalUnit ?? 'N*mm*s^2',
  );
  const massControls = [...massInputs, translationalUnit, rotationalUnit];
  const updateMassControls = (): void => setInputsEnabled(massEnabled.checked, massControls);
  massEnabled.addEventListener('change', updateMassControls);
  updateMassControls();

  const sourceNodes = Document.instance.getImportSourceNodes(node);
  if (sourceNodes && sourceNodes.length > 0) {
    addFormRow(box, t('import.sourceId'), 'text', sourceNodes.map((info) => info.sourceId).join(', '), true);
  }

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: NodeDialogResult | null = null;
  const confirmed = await wireDialog(overlay, okBtn, cancelBtn, () => {
    const x = readFiniteNumber(inputX);
    const y = readFiniteNumber(inputY);
    const z = readFiniteNumber(inputZ);
    if (x === null || y === null || z === null) return false;

    let mass: NodeMass | null = null;
    if (massEnabled.checked) {
      const values: number[] = [];
      for (const input of massInputs) {
        const value = readValidatedNumber(input, (candidate) => candidate >= 0, t('validation.nonNegativeNumber'));
        if (value === null) return false;
        values.push(value);
      }
      const parsedTranslationalUnit = readRequiredText(translationalUnit);
      if (parsedTranslationalUnit === null) return false;
      const parsedRotationalUnit = readRequiredText(rotationalUnit);
      if (parsedRotationalUnit === null) return false;
      mass = {
        values: values as DofVector6,
        translationalUnit: parsedTranslationalUnit,
        rotationalUnit: parsedRotationalUnit,
      };
    }

    const pos = new Point3D(x, y, z);
    if (!pointEquals(pos, node.pos) || !massEquals(mass, node.mass)) result = { pos, mass };
    return true;
  });
  return confirmed ? result : null;
}

function pointEquals(first: Point3D, second: Point3D): boolean {
  return first.x === second.x && first.y === second.y && first.z === second.z;
}

function massEquals(first: NodeMass | null, second: NodeMass | null): boolean {
  if (first === null || second === null) return first === second;
  return (
    first.translationalUnit === second.translationalUnit &&
    first.rotationalUnit === second.rotationalUnit &&
    first.values.every((value, index) => value === second.values[index])
  );
}
