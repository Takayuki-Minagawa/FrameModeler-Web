import { AddLayerCommand, UpdateLayersCommand } from '../commands/DocumentCommands';
import type { Document } from '../data/Document';
import { Layer } from '../data/Layer';
import type { CadView } from '../ui/CadView';
import { showLayerDialog } from '../ui/dialogs/LayerDialog';
import { getLocale, t } from '../i18n';

type TrackChange = <T>(label: string, action: () => T | Promise<T>) => Promise<T>;

export interface LayerControllerOptions {
  document: Document;
  cadView: CadView;
  list: HTMLUListElement;
  coordinateZ: HTMLInputElement;
  trackChange: TrackChange;
  cancelOperation: () => void;
  copyContents: (source: Layer, target: Layer) => void;
  root?: globalThis.Document;
}

/** レイヤー一覧、stable ID、表示/ロック/隔離、複製と上下階コピーを管理する。 */
export class LayerController {
  private readonly root: globalThis.Document;

  constructor(private readonly options: LayerControllerOptions) {
    this.root = options.root ?? document;
  }

  connect(): void {
    this.options.list.addEventListener('click', (event) => this.handleListClick(event));
    this.options.list.addEventListener('dblclick', (event) => this.handleListDoubleClick(event));
    this.options.list.addEventListener('keydown', (event) => this.handleListKeydown(event));
    this.root.getElementById('btn-add-layer')?.addEventListener('click', () => void this.add());
    this.root.getElementById('btn-remove-layer')?.addEventListener('click', () => void this.remove());
    this.root.getElementById('btn-duplicate-layer')?.addEventListener('click', () => void this.duplicate());
    this.root.getElementById('btn-copy-layer-up')?.addEventListener('click', () => void this.copyToAdjacent(1));
    this.root.getElementById('btn-copy-layer-down')?.addEventListener('click', () => void this.copyToAdjacent(-1));
    this.root.getElementById('btn-show-all-layers')?.addEventListener('click', () => void this.showAll());

    this.options.document.subscribeLayerView(() => this.refreshAfterDocumentChange());
    this.render();
  }

  render(): void {
    const { document: model, list, coordinateZ } = this.options;
    list.replaceChildren();
    coordinateZ.value = model.shownLayer ? String(model.shownLayer.posZ) : '';
    for (const layer of model.layers) list.appendChild(this.createLayerItem(layer));
  }

  select(layer: Layer): void {
    if (!this.options.document.layers.includes(layer)) return;
    this.options.cancelOperation();
    this.options.document.shownLayer = layer;
    this.options.coordinateZ.value = String(layer.posZ);
    this.updateSelectionState();
    this.options.cadView.render();
  }

  private createLayerItem(layer: Layer): HTMLLIElement {
    const item = this.root.createElement('li');
    item.dataset.layerId = layer.id;
    item.setAttribute('role', 'option');

    const label = this.root.createElement('span');
    label.className = 'layer-label';
    label.textContent = formatLayerLabel(layer);
    item.appendChild(label);

    const controls = this.root.createElement('span');
    controls.className = 'layer-item-controls';
    controls.append(
      this.createActionButton('visibility', layer.visible ? '◉' : '○', layer.visible ? 'Hide layer' : 'Show layer'),
      this.createActionButton('lock', layer.locked ? '🔒' : '🔓', layer.locked ? 'Unlock layer' : 'Lock layer'),
      this.createActionButton('isolate', '◎', 'Isolate layer'),
    );
    item.appendChild(controls);

    this.applyItemState(item, layer);
    return item;
  }

  private createActionButton(action: string, text: string, label: string): HTMLButtonElement {
    const button = this.root.createElement('button');
    button.type = 'button';
    button.className = 'layer-action';
    button.dataset.action = action;
    button.textContent = text;
    button.setAttribute('aria-label', label);
    return button;
  }

  private applyItemState(item: HTMLLIElement, layer: Layer): void {
    const active = layer === this.options.document.shownLayer;
    item.classList.toggle('active', active);
    item.classList.toggle('layer-hidden', !layer.visible);
    item.classList.toggle('layer-locked', layer.locked);
    item.setAttribute('aria-selected', String(active));
    item.setAttribute(
      'aria-description',
      `${layer.visible ? 'visible' : 'hidden'}, ${layer.locked ? 'locked' : 'editable'}`,
    );
    item.tabIndex = active || (!this.options.document.shownLayer && this.options.document.layers[0] === layer) ? 0 : -1;
  }

  private handleListClick(event: MouseEvent): void {
    const item = (event.target as HTMLElement).closest<HTMLLIElement>('li[data-layer-id]');
    const layer = item ? this.findLayer(item.dataset.layerId) : null;
    if (!layer) return;
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) {
      this.select(layer);
      return;
    }
    event.stopPropagation();
    if (action === 'visibility') void this.toggleVisibility(layer);
    else if (action === 'lock') void this.toggleLocked(layer);
    else if (action === 'isolate') void this.isolate(layer);
  }

  private handleListDoubleClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('[data-action]')) return;
    const item = (event.target as HTMLElement).closest<HTMLLIElement>('li[data-layer-id]');
    const layer = item ? this.findLayer(item.dataset.layerId) : null;
    if (layer) void this.edit(layer);
  }

  private handleListKeydown(event: KeyboardEvent): void {
    const item = (event.target as HTMLElement).closest<HTMLLIElement>('li[data-layer-id]');
    const layer = item ? this.findLayer(item.dataset.layerId) : null;
    if (!layer) return;
    const index = this.options.document.layers.indexOf(layer);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.max(0, Math.min(this.options.document.layers.length - 1, index + offset));
      const target = this.options.document.layers[next];
      if (target) {
        this.select(target);
        [...this.options.list.querySelectorAll<HTMLElement>('li[data-layer-id]')]
          .find((candidate) => candidate.dataset.layerId === target.id)
          ?.focus();
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select(layer);
    }
  }

  private async add(): Promise<void> {
    this.options.cancelOperation();
    const layer = await showLayerDialog();
    if (!layer) return;
    await this.run('レイヤー追加', () => {
      if (!this.options.document.execute(new AddLayerCommand(layer))) throw new Error(t('msg.duplicateLayer'));
      this.options.document.shownLayer = layer;
    });
  }

  private async edit(layer: Layer): Promise<void> {
    this.options.cancelOperation();
    if (layer.locked) {
      alert(this.localized('ロック中のレイヤーは編集できません。', 'A locked layer cannot be edited.'));
      return;
    }
    const edited = await showLayerDialog(layer);
    if (!edited) return;
    await this.run('レイヤー編集', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー編集', (document) => {
          if (!document.updateLayer(layer, { name: edited.name, posZ: edited.posZ })) {
            throw new Error('Layer not found');
          }
          document.shownLayer = layer;
        }),
      );
    });
  }

  private async remove(): Promise<void> {
    this.options.cancelOperation();
    const layer = this.options.document.shownLayer;
    if (!layer) return;
    if (layer.locked) {
      alert(this.localized('ロック中のレイヤーは削除できません。', 'A locked layer cannot be deleted.'));
      return;
    }
    const count = this.options.document.allDataList.filter((data) => data.existsOn(layer)).length;
    if (
      !confirm(
        this.localized(
          `レイヤー「${layer.name}」を削除しますか？（関連要素: ${count}）`,
          `Delete layer "${layer.name}"? (${count} related elements)`,
        ),
      )
    )
      return;
    await this.run('レイヤー削除', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー削除', (document) => void document.removeLayer(layer)),
      );
    });
  }

  private async duplicate(): Promise<void> {
    const source = this.options.document.shownLayer;
    if (!source) return;
    const suggestion = new Layer(this.suggestAdjacentZ(source, 1), `${source.name} copy`, {
      visible: source.visible,
      locked: false,
    });
    const target = await showLayerDialog(suggestion);
    if (!target) return;
    await this.run('レイヤー複製', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー複製', (document) => {
          if (!document.addLayer(target)) throw new Error(t('msg.duplicateLayer'));
          this.options.copyContents(source, target);
          document.shownLayer = target;
        }),
      );
    });
  }

  private async copyToAdjacent(direction: -1 | 1): Promise<void> {
    const source = this.options.document.shownLayer;
    if (!source) return;
    const index = this.options.document.layers.indexOf(source);
    const target = this.options.document.layers[index + direction];
    if (!target) {
      alert(this.localized('コピー先の隣接レイヤーがありません。', 'There is no adjacent target layer.'));
      return;
    }
    if (target.locked) {
      alert(this.localized('コピー先レイヤーはロックされています。', 'The target layer is locked.'));
      return;
    }
    await this.run('レイヤー要素コピー', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー要素コピー', () => this.options.copyContents(source, target)),
      );
    });
  }

  private async toggleVisibility(layer: Layer): Promise<void> {
    await this.run('レイヤー表示変更', () => {
      this.options.document.execute(
        new UpdateLayersCommand(
          'レイヤー表示変更',
          (document) => void document.updateLayer(layer, { visible: !layer.visible }),
        ),
      );
    });
  }

  private async toggleLocked(layer: Layer): Promise<void> {
    await this.run('レイヤーロック変更', () => {
      this.options.document.execute(
        new UpdateLayersCommand(
          'レイヤーロック変更',
          (document) => void document.updateLayer(layer, { locked: !layer.locked }),
        ),
      );
    });
  }

  private async isolate(layer: Layer): Promise<void> {
    await this.run('レイヤー隔離', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー隔離', (document) => void document.isolateLayer(layer)),
      );
    });
  }

  private async showAll(): Promise<void> {
    await this.run('全レイヤー表示', () => {
      this.options.document.execute(new UpdateLayersCommand('全レイヤー表示', (document) => document.showAllLayers()));
    });
  }

  private async run(label: string, action: () => void): Promise<void> {
    // レイヤー変更は作業面・編集可否・表示対象を変えるため、どの入口からでも
    // mutation直前に作図中のanchor/previewを共通境界で破棄する。
    this.options.cancelOperation();
    try {
      await this.options.trackChange(label, action);
      this.render();
      this.options.cadView.renderElements();
    } catch (error) {
      alert(
        this.localized(
          `レイヤー操作に失敗しました: ${(error as Error).message}`,
          `Layer operation failed: ${(error as Error).message}`,
        ),
      );
    }
  }

  private refreshAfterDocumentChange(): void {
    const items = [...this.options.list.querySelectorAll<HTMLLIElement>('li[data-layer-id]')];
    const structureChanged =
      items.length !== this.options.document.layers.length ||
      items.some((item, index) => item.dataset.layerId !== this.options.document.layers[index]?.id);
    if (structureChanged) {
      this.render();
      return;
    }

    // 同一ID構成のundo/redoでも、名前・高さ・visible/lockedは変わり得る。
    // DOMを置換せず同期して、キーボード操作中のfocusを維持する。
    this.options.coordinateZ.value = this.options.document.shownLayer
      ? String(this.options.document.shownLayer.posZ)
      : '';
    items.forEach((item, index) => {
      const layer = this.options.document.layers[index];
      if (!layer) return;
      const label = item.querySelector<HTMLElement>('.layer-label');
      if (label) label.textContent = formatLayerLabel(layer);
      const visibility = item.querySelector<HTMLButtonElement>('[data-action="visibility"]');
      if (visibility) {
        visibility.textContent = layer.visible ? '◉' : '○';
        visibility.setAttribute('aria-label', layer.visible ? 'Hide layer' : 'Show layer');
      }
      const lock = item.querySelector<HTMLButtonElement>('[data-action="lock"]');
      if (lock) {
        lock.textContent = layer.locked ? '🔒' : '🔓';
        lock.setAttribute('aria-label', layer.locked ? 'Unlock layer' : 'Lock layer');
      }
      this.applyItemState(item, layer);
    });
  }

  private updateSelectionState(): void {
    for (const item of this.options.list.querySelectorAll<HTMLLIElement>('li[data-layer-id]')) {
      const layer = this.findLayer(item.dataset.layerId);
      if (layer) this.applyItemState(item, layer);
    }
  }

  private findLayer(id: string | undefined): Layer | null {
    return this.options.document.layers.find((layer) => layer.id === id) ?? null;
  }

  private suggestAdjacentZ(source: Layer, direction: -1 | 1): number {
    const layers = this.options.document.layers;
    const index = layers.indexOf(source);
    const neighbor = layers[index + direction];
    const other = neighbor ?? layers[index - direction];
    const height = other ? Math.abs(other.posZ - source.posZ) : 3000;
    return source.posZ + direction * (height || 3000);
  }

  private localized(ja: string, en: string): string {
    return getLocale() === 'ja' ? ja : en;
  }
}

/** data層のLayerへ表示責務を戻さないためのUI formatter。 */
export function formatLayerLabel(layer: Layer): string {
  return `${layer.name} : ${layer.posZ}`;
}
