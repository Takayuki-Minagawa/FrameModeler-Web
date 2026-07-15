import { Document } from '../../data/Document';
import { Member } from '../../data/Member';
import { Spring, type SpringComponent } from '../../data/Spring';
import { STRUCTURAL_DOFS, type StructuralDof } from '../../data/StructuralDof';
import { Truss } from '../../data/Truss';
import { t, type MessageKey } from '../../i18n';
import { Point3D } from '../../math/Point3D';
import {
  addButtonRow,
  addFormRow,
  addNodeRow,
  clearFieldError,
  createDialogBox,
  createModalOverlay,
  readFiniteNumber,
  setFieldError,
  wireDialog,
} from './DialogUtil';
import {
  addCheckboxRow,
  addStructuralFieldset,
  defaultStiffnessUnit,
  dofLabel,
  readOptionalValidatedNumber,
  readRequiredText,
  readValidatedNumber,
  setCheckboxGroupError,
  setInputsEnabled,
} from './StructuralDialogUtil';

export interface BasicMemberDialogResult {
  kind: 'beam' | 'pillar';
  section: string;
}

export interface TrussDialogResult {
  kind: 'truss';
  section: string;
  material: string;
  area: number;
  areaUnit: string;
  elasticModulus: number | null;
  stressUnit: string;
}

export interface SpringDialogResult {
  kind: 'spring';
  section: string;
  components: SpringComponent[];
  orientX: Point3D | null;
  orientY: Point3D | null;
  shearDistance: [number, number] | null;
  note: string;
}

/** Commandへ渡すMemberプロパティの型別完全スナップショット。 */
export type MemberDialogResult = BasicMemberDialogResult | TrussDialogResult | SpringDialogResult;

interface TrussControls {
  material: HTMLInputElement;
  area: HTMLInputElement;
  areaUnit: HTMLInputElement;
  elasticModulus: HTMLInputElement;
  stressUnit: HTMLInputElement;
}

interface SpringComponentControls {
  dof: StructuralDof;
  enabled: HTMLInputElement;
  stiffness: HTMLInputElement;
  unit: HTMLInputElement;
}

interface OptionalVectorControls {
  enabled: HTMLInputElement;
  x: HTMLInputElement;
  y: HTMLInputElement;
  z: HTMLInputElement;
}

interface OptionalPairControls {
  enabled: HTMLInputElement;
  first: HTMLInputElement;
  second: HTMLInputElement;
}

interface SpringControls {
  components: SpringComponentControls[];
  orientX: OptionalVectorControls;
  orientY: OptionalVectorControls;
  shearDistance: OptionalPairControls;
  note: HTMLInputElement;
}

/** 梁・柱・トラス・ばねを型固有の情報を失わず編集する。モデル自体は変更しない。 */
export async function showMemberDialog(member: Member): Promise<MemberDialogResult | null> {
  const overlay = createModalOverlay();
  const box = createDialogBox(t(memberTitleKey(member)));
  if (member instanceof Truss || member instanceof Spring) box.classList.add('wide-dialog');

  if (member.nodeI) addNodeRow(box, 'NodeI', member.nodeI);
  else addFormRow(box, 'NodeI', 'text', '—', true);
  if (member.nodeJ) addNodeRow(box, 'NodeJ', member.nodeJ);
  else addFormRow(box, 'NodeJ', 'text', '—', true);
  const inputSection = addFormRow(box, t('section'), 'text', member.section);

  const trussControls = member instanceof Truss ? buildTrussControls(box, member) : null;
  const springControls = member instanceof Spring ? buildSpringControls(box, member) : null;

  const sourceElements = Document.instance.getImportSourceElements(member);
  if (sourceElements && sourceElements.length > 0) {
    const info = sourceElements[0];
    addFormRow(box, t('import.sourceId'), 'text', info.sourceId, true);
    addFormRow(box, t('import.sourceType'), 'text', info.sourceType, true);
    addFormRow(box, t('import.material'), 'text', info.material ?? '', true);
    if (info.elementTags && info.elementTags.length > 0) {
      addFormRow(box, t('import.elementTags'), 'text', info.elementTags.join(', '), true);
    }
  }

  const { okBtn, cancelBtn } = addButtonRow(box);
  overlay.appendChild(box);

  let result: MemberDialogResult | null = null;
  const confirmed = await wireDialog(overlay, okBtn, cancelBtn, () => {
    if (member instanceof Truss && trussControls) {
      const parsed = readTrussResult(member, inputSection.value, trussControls);
      if (parsed === null) return false;
      if (!trussResultEqualsMember(parsed, member)) result = parsed;
      return true;
    }

    if (member instanceof Spring && springControls) {
      const parsed = readSpringResult(inputSection.value, springControls);
      if (parsed === null) return false;
      if (!springResultEqualsMember(parsed, member)) result = parsed;
      return true;
    }

    const kind: BasicMemberDialogResult['kind'] = member.kind === 'beam' ? 'beam' : 'pillar';
    if (member.section !== inputSection.value) result = { kind, section: inputSection.value };
    return true;
  });
  return confirmed ? result : null;
}

function memberTitleKey(member: Member): MessageKey {
  if (member instanceof Truss) return 'dialog.trussProps';
  if (member instanceof Spring) return 'dialog.springProps';
  return member.kind === 'beam' ? 'dialog.beamProps' : 'dialog.pillarProps';
}

function buildTrussControls(container: HTMLElement, truss: Truss): TrussControls {
  const fieldset = addStructuralFieldset(container, t('structural.trussProperties'));
  return {
    material: addFormRow(fieldset, t('structural.material'), 'text', truss.material),
    area: addFormRow(fieldset, t('structural.area'), 'number', String(truss.area)),
    areaUnit: addFormRow(fieldset, t('structural.areaUnit'), 'text', truss.areaUnit),
    elasticModulus: addFormRow(
      fieldset,
      t('structural.elasticModulus'),
      'number',
      truss.elasticModulus === null ? '' : String(truss.elasticModulus),
    ),
    stressUnit: addFormRow(fieldset, t('structural.stressUnit'), 'text', truss.stressUnit),
  };
}

function readTrussResult(truss: Truss, section: string, controls: TrussControls): TrussDialogResult | null {
  const area = readValidatedNumber(controls.area, (value) => value > 0, t('validation.positiveNumber'));
  if (area === null) return null;
  const areaUnit = readRequiredText(controls.areaUnit);
  if (areaUnit === null) return null;
  const elasticModulus = readOptionalValidatedNumber(
    controls.elasticModulus,
    (value) => value > 0,
    t('validation.positiveNumber'),
  );
  if (elasticModulus === undefined) return null;
  const stressUnit = readRequiredText(controls.stressUnit);
  if (stressUnit === null) return null;
  return {
    kind: 'truss',
    section,
    material: controls.material.value.trim(),
    area,
    areaUnit,
    elasticModulus,
    stressUnit,
  };
}

function buildSpringControls(container: HTMLElement, spring: Spring): SpringControls {
  const componentFieldset = addStructuralFieldset(container, t('structural.springComponents'));
  const byDof = new Map(spring.components.map((component) => [component.dof, component]));
  const components = STRUCTURAL_DOFS.map((dof) => {
    const component = byDof.get(dof);
    const enabled = addCheckboxRow(
      componentFieldset,
      `${dofLabel(dof)} — ${t('structural.enableDof')}`,
      component !== undefined,
    );
    const stiffness = addFormRow(
      componentFieldset,
      `${dof.toUpperCase()} ${t('structural.stiffness')}`,
      'number',
      String(component?.stiffness ?? 1),
    );
    const unit = addFormRow(
      componentFieldset,
      `${dof.toUpperCase()} ${t('structural.unit')}`,
      'text',
      component?.unit ?? defaultStiffnessUnit(dof),
    );
    const update = (): void => setInputsEnabled(enabled.checked, [stiffness, unit]);
    enabled.addEventListener('change', update);
    update();
    return { dof, enabled, stiffness, unit };
  });
  components.forEach(({ enabled }) => enabled.addEventListener('change', () => clearFieldError(components[0].enabled)));

  const orientationFieldset = addStructuralFieldset(container, t('structural.springOrientation'));
  const orientX = buildOptionalVector(orientationFieldset, t('structural.enableOrientX'), 'X', spring.orientX);
  const orientY = buildOptionalVector(orientationFieldset, t('structural.enableOrientY'), 'Y', spring.orientY);

  const shearFieldset = addStructuralFieldset(container, t('structural.shearDistance'));
  const shearEnabled = addCheckboxRow(
    shearFieldset,
    t('structural.enableShearDistance'),
    spring.shearDistance !== null,
  );
  const shearI = addFormRow(shearFieldset, 'I', 'number', String(spring.shearDistance?.[0] ?? 0.5));
  const shearJ = addFormRow(shearFieldset, 'J', 'number', String(spring.shearDistance?.[1] ?? 0.5));
  const updateShear = (): void => setInputsEnabled(shearEnabled.checked, [shearI, shearJ]);
  shearEnabled.addEventListener('change', updateShear);
  updateShear();

  return {
    components,
    orientX,
    orientY,
    shearDistance: { enabled: shearEnabled, first: shearI, second: shearJ },
    note: addFormRow(container, t('structural.note'), 'text', spring.note),
  };
}

function buildOptionalVector(
  container: HTMLElement,
  checkboxLabel: string,
  coordinatePrefix: string,
  initial: Point3D | null,
): OptionalVectorControls {
  const enabled = addCheckboxRow(container, checkboxLabel, initial !== null);
  const x = addFormRow(
    container,
    `${coordinatePrefix}.x`,
    'number',
    String(initial?.x ?? (coordinatePrefix === 'X' ? 1 : 0)),
  );
  const y = addFormRow(
    container,
    `${coordinatePrefix}.y`,
    'number',
    String(initial?.y ?? (coordinatePrefix === 'Y' ? 1 : 0)),
  );
  const z = addFormRow(container, `${coordinatePrefix}.z`, 'number', String(initial?.z ?? 0));
  const update = (): void => setInputsEnabled(enabled.checked, [x, y, z]);
  enabled.addEventListener('change', update);
  update();
  return { enabled, x, y, z };
}

function readSpringResult(section: string, controls: SpringControls): SpringDialogResult | null {
  const components: SpringComponent[] = [];
  for (const control of controls.components) {
    if (!control.enabled.checked) continue;
    const stiffness = readValidatedNumber(control.stiffness, (value) => value > 0, t('validation.positiveNumber'));
    if (stiffness === null) return null;
    const unit = readRequiredText(control.unit);
    if (unit === null) return null;
    components.push({ dof: control.dof, stiffness, unit });
  }
  if (components.length === 0) {
    setCheckboxGroupError(controls.components[0].enabled, t('validation.springDofRequired'));
    return null;
  }

  const orientX = readOptionalVector(controls.orientX);
  if (orientX === undefined) return null;
  const orientY = readOptionalVector(controls.orientY);
  if (orientY === undefined) return null;
  if (orientX && orientY && Point3D.crossProduct(orientX, orientY).length <= 1e-9) {
    setFieldError(controls.orientY.z, t('validation.vectorsNotParallel'));
    return null;
  }

  let shearDistance: [number, number] | null = null;
  if (controls.shearDistance.enabled.checked) {
    const first = readValidatedNumber(
      controls.shearDistance.first,
      (value) => value >= 0 && value <= 1,
      t('validation.zeroToOne'),
    );
    if (first === null) return null;
    const second = readValidatedNumber(
      controls.shearDistance.second,
      (value) => value >= 0 && value <= 1,
      t('validation.zeroToOne'),
    );
    if (second === null) return null;
    shearDistance = [first, second];
  }

  return {
    kind: 'spring',
    section,
    components,
    orientX,
    orientY,
    shearDistance,
    note: controls.note.value,
  };
}

function readOptionalVector(controls: OptionalVectorControls): Point3D | null | undefined {
  if (!controls.enabled.checked) return null;
  const x = readFiniteNumber(controls.x);
  const y = readFiniteNumber(controls.y);
  const z = readFiniteNumber(controls.z);
  if (x === null || y === null || z === null) return undefined;
  const vector = new Point3D(x, y, z);
  if (vector.length <= 1e-9) {
    setFieldError(controls.z, t('validation.vectorNonZero'));
    return undefined;
  }
  return vector;
}

function trussResultEqualsMember(result: TrussDialogResult, truss: Truss): boolean {
  return (
    result.section === truss.section &&
    result.material === truss.material &&
    result.area === truss.area &&
    result.areaUnit === truss.areaUnit &&
    result.elasticModulus === truss.elasticModulus &&
    result.stressUnit === truss.stressUnit
  );
}

function springResultEqualsMember(result: SpringDialogResult, spring: Spring): boolean {
  const existingComponents = new Map(spring.components.map((component) => [component.dof, component]));
  return (
    result.section === spring.section &&
    result.note === spring.note &&
    pointEquals(result.orientX, spring.orientX) &&
    pointEquals(result.orientY, spring.orientY) &&
    pairEquals(result.shearDistance, spring.shearDistance) &&
    result.components.length === existingComponents.size &&
    result.components.every((component) => {
      const existing = existingComponents.get(component.dof);
      return existing?.stiffness === component.stiffness && existing.unit === component.unit;
    })
  );
}

function pointEquals(first: Point3D | null, second: Point3D | null): boolean {
  if (first === null || second === null) return first === second;
  return first.x === second.x && first.y === second.y && first.z === second.z;
}

function pairEquals(first: [number, number] | null, second: [number, number] | null): boolean {
  if (first === null || second === null) return first === second;
  return first[0] === second[0] && first[1] === second[1];
}
