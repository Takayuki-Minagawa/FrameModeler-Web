import { UpdatePropertiesCommand } from '../commands/DocumentCommands';
import { Constraint } from '../data/Constraint';
import type { Document } from '../data/Document';
import type { DocumentData } from '../data/DocumentData';
import { Floor } from '../data/Floor';
import { Member } from '../data/Member';
import { Node } from '../data/Node';
import { Plane } from '../data/Plane';
import { Spring } from '../data/Spring';
import { cloneNodeMass } from '../data/StructuralDof';
import { Support } from '../data/Support';
import { Truss } from '../data/Truss';
import { Wall } from '../data/Wall';
import { t, type HistoryMessageKey } from '../i18n';
import { showConstraintDialog } from '../ui/dialogs/ConstraintDialog';
import { showMemberDialog } from '../ui/dialogs/MemberDialog';
import { showNodeDialog } from '../ui/dialogs/NodeDialog';
import { showPlaneDialog } from '../ui/dialogs/PlaneDialog';
import { showSupportDialog } from '../ui/dialogs/SupportDialog';

export type TrackChange = <T>(label: HistoryMessageKey, action: () => T | Promise<T>) => Promise<T>;

export interface PropertyEditControllerOptions {
  document: Document;
  trackChange: TrackChange;
  /** ダイアログを閉じた後（確定・キャンセル・失敗のいずれでも）に呼ぶ。 */
  onFinished: () => void;
}

/** 要素種別に応じたプロパティダイアログを開き、確定内容を1 Commandとして適用する。 */
export class PropertyEditController {
  constructor(private readonly options: PropertyEditControllerOptions) {}

  edit = async (data: DocumentData): Promise<void> => {
    try {
      await this.options.trackChange('history.propertyEdit', () => this.showDialogAndApply(data));
    } catch (error) {
      alert(t('msg.applyChangeFailed', { message: (error as Error).message }));
    }
    this.options.onFinished();
  };

  private async showDialogAndApply(data: DocumentData): Promise<void> {
    const doc = this.options.document;
    if (data instanceof Node) {
      const changes = await showNodeDialog(data);
      if (!changes) return;
      doc.execute(
        new UpdatePropertiesCommand('節点プロパティ編集', data, (node) => {
          node.pos = changes.pos.clone();
          node.mass = cloneNodeMass(changes.mass);
        }),
      );
    } else if (data instanceof Member) {
      const changes = await showMemberDialog(data);
      if (!changes) return;
      doc.execute(
        new UpdatePropertiesCommand('部材プロパティ編集', data, (member) => {
          member.section = changes.section;
          if (member instanceof Truss && changes.kind === 'truss') {
            member.material = changes.material;
            member.area = changes.area;
            member.areaUnit = changes.areaUnit;
            member.elasticModulus = changes.elasticModulus;
            member.stressUnit = changes.stressUnit;
          } else if (member instanceof Spring && changes.kind === 'spring') {
            member.components = changes.components.map((component) => ({ ...component }));
            member.orientX = changes.orientX?.clone() ?? null;
            member.orientY = changes.orientY?.clone() ?? null;
            member.shearDistance = changes.shearDistance ? [...changes.shearDistance] : null;
            member.note = changes.note;
          }
        }),
      );
    } else if (data instanceof Plane) {
      const changes = await showPlaneDialog(data);
      if (!changes) return;
      doc.execute(
        new UpdatePropertiesCommand('面プロパティ編集', data, (plane) => {
          plane.section = changes.section;
          if (plane instanceof Floor) {
            if (changes.weight !== undefined) plane.weight = changes.weight;
            if (changes.direction !== undefined) plane.direction = changes.direction;
          } else if (plane instanceof Wall && changes.weight !== undefined) {
            plane.weight = changes.weight;
          }
        }),
      );
    } else if (data instanceof Support) {
      const changes = await showSupportDialog(data);
      if (!changes) return;
      doc.execute(
        new UpdatePropertiesCommand('支点プロパティ編集', data, (support) => {
          support.fixedDofs = [...changes.fixedDofs];
        }),
      );
    } else if (data instanceof Constraint) {
      const changes = await showConstraintDialog(data);
      if (!changes) return;
      doc.execute(
        new UpdatePropertiesCommand('拘束プロパティ編集', data, (constraint) => {
          constraint.slaveDof = changes.slaveDof;
          constraint.terms = changes.terms.map((term) => ({ ...term }));
        }),
      );
    }
  }
}
