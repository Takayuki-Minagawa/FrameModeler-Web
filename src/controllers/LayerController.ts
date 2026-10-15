import { AddLayerCommand, UpdateLayersCommand } from '../commands/DocumentCommands';
import type { Document } from '../data/Document';
import { Layer } from '../data/Layer';
import type { CadView } from '../ui/CadView';
import { showLayerDialog } from '../ui/dialogs/LayerDialog';
import { showChoiceDialog, showConfirmDialog, showMessageDialog } from '../ui/dialogs/MessageDialog';
import { subscribeLocaleChanged, t, type HistoryMessageKey } from '../i18n';

type TrackChange = <T>(label: HistoryMessageKey, action: () => T | Promise<T>) => Promise<T>;

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

/** 階高の既定値 (mm)。隣接レイヤーから求められないときに使う。 */
export const DEFAULT_STORY_HEIGHT = 3000;
const Z_TOLERANCE = 1e-6;

type LayerDeleteChoice = 'withElements' | 'keepElements';

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
    // 行ごとの操作ボタンの文言はここで生成するため、言語切替時に作り直す。
    subscribeLocaleChanged(() => this.render());
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

  /**
   * 柱・壁の直上に何も無く上階レイヤーも無いとき、階高を指定して上階レイヤーを作る。
   * 作成できたら true。利用者が取り消したら false。
   */
  async requestLayerAbove(currentZ: number): Promise<boolean> {
    const layers = this.options.document.layers;
    const suggestion = new Layer(currentZ + this.typicalStoryHeight(), this.nextLayerName());
    const layer = await showLayerDialog(suggestion, {
      mode: 'add',
      title: t('dialog.layerAbove'),
      description: t('layer.aboveDescription', { z: currentZ }),
    });
    if (!layer) return false;
    if (layer.posZ <= currentZ) {
      await showMessageDialog(t('msg.layerAboveMustBeHigher', { z: currentZ }), { level: 'error' });
      return false;
    }
    const shown = this.options.document.shownLayer;
    // 柱・壁の配置をこの後に続けるため、run() と違って作図中の操作は取り消さない。
    // 作業階も変えないので、既存の anchor / preview はそのまま有効。
    try {
      await this.options.trackChange('history.addLayer', () => {
        if (!this.options.document.execute(new AddLayerCommand(layer))) throw new Error(t('msg.duplicateLayer'));
        if (shown && layers.includes(shown)) this.options.document.shownLayer = shown;
      });
      this.render();
      this.options.cadView.renderElements();
    } catch (error) {
      await showMessageDialog(t('msg.layerOperationFailed', { message: (error as Error).message }), {
        level: 'error',
      });
    }
    return this.options.document.layers.includes(layer);
  }

  private createLayerItem(layer: Layer): HTMLLIElement {
    const item = this.root.createElement('li');
    item.dataset.layerId = layer.id;
    item.setAttribute('role', 'option');

    const label = this.root.createElement('span');
    label.className = 'layer-label';
    label.textContent = layer.name;
    label.title = formatLayerLabel(layer);
    item.appendChild(label);

    const height = this.root.createElement('span');
    height.className = 'layer-height';
    height.textContent = formatLayerHeight(layer);
    height.title = t('zPosition');
    item.appendChild(height);

    const controls = this.root.createElement('span');
    controls.className = 'layer-item-controls';
    controls.append(
      this.createActionButton('visibility', layer.visible ? '◉' : '○', t(layer.visible ? 'layer.hide' : 'layer.show')),
      this.createActionButton('lock', layer.locked ? '🔒' : '🔓', t(layer.locked ? 'layer.unlock' : 'layer.lock')),
      this.createActionButton('isolate', '◎', t('layer.isolate')),
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
    button.title = label;
    return button;
  }

  private applyItemState(item: HTMLLIElement, layer: Layer): void {
    const { document: model } = this.options;
    const active = layer === model.shownLayer;
    item.classList.toggle('active', active);
    item.classList.toggle('layer-hidden', !layer.visible);
    item.classList.toggle('layer-locked', layer.locked);
    item.setAttribute('aria-selected', String(active));
    item.setAttribute(
      'aria-description',
      `${t(layer.visible ? 'layer.state.visible' : 'layer.state.hidden')}, ${t(layer.locked ? 'layer.state.locked' : 'layer.state.editable')}`,
    );
    item.tabIndex = active || (!model.shownLayer && model.layers[0] === layer) ? 0 : -1;

    // 表示・ロック・隔離の現在状態を支援技術からも読めるよう aria-pressed で示す。
    const isolated = layer.visible && model.layers.every((other) => other === layer || !other.visible);
    item.querySelector('[data-action="visibility"]')?.setAttribute('aria-pressed', String(layer.visible));
    item.querySelector('[data-action="lock"]')?.setAttribute('aria-pressed', String(layer.locked));
    item.querySelector('[data-action="isolate"]')?.setAttribute('aria-pressed', String(isolated));
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
    const layers = this.options.document.layers;
    const top = layers[layers.length - 1];
    const suggestion = new Layer(top ? top.posZ + this.typicalStoryHeight() : 0, this.nextLayerName());
    const layer = await showLayerDialog(suggestion, { mode: 'add' });
    if (!layer) return;
    await this.run('history.addLayer', () => {
      if (!this.options.document.execute(new AddLayerCommand(layer))) throw new Error(t('msg.duplicateLayer'));
      this.options.document.shownLayer = layer;
    });
  }

  private async edit(layer: Layer): Promise<void> {
    this.options.cancelOperation();
    if (layer.locked) {
      await showMessageDialog(t('msg.layerLockedEdit'));
      return;
    }
    const edited = await showLayerDialog(layer, { mode: 'edit' });
    if (!edited) return;
    await this.run('history.editLayer', () => {
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

  /**
   * レイヤー削除。この高さの節点と関連要素があれば「要素も削除」「要素は残す」を選ばせ、
   * 残す場合はどの階からも見えない要素が生まれることを明示する。
   */
  private async remove(): Promise<void> {
    this.options.cancelOperation();
    const { document: model } = this.options;
    const layer = model.shownLayer;
    if (!layer) return;
    if (layer.locked) {
      await showMessageDialog(t('msg.layerLockedDelete'));
      return;
    }
    const related = model.dataOnLayerElevation(layer);
    let choice: LayerDeleteChoice | null = 'keepElements';
    if (related.length === 0) {
      if (!(await showConfirmDialog(t('msg.confirmDeleteEmptyLayer', { name: layer.name }), { danger: true }))) return;
    } else {
      choice = await showChoiceDialog<LayerDeleteChoice>(
        t('msg.confirmDeleteLayer', { name: layer.name, count: related.length }),
        [
          { label: t('layer.deleteKeepElements'), value: 'keepElements' },
          { label: t('layer.deleteWithElements'), value: 'withElements', primary: true, danger: true },
        ],
        { title: t('title.removeLayer') },
      );
      if (!choice) return;
      if (choice === 'withElements' && related.some((data) => model.isDataLocked(data))) {
        await showMessageDialog(t('msg.layerDeleteLockedElements'), { level: 'error' });
        return;
      }
    }
    await this.run('history.removeLayer', () => {
      model.execute(
        new UpdateLayersCommand('レイヤー削除', (document) => {
          if (choice === 'withElements') document.removeMany(related);
          document.removeLayer(layer);
        }),
      );
    });
  }

  private async duplicate(): Promise<void> {
    const source = this.options.document.shownLayer;
    if (!source) return;
    const suggestion = new Layer(this.suggestDuplicateZ(source), `${source.name} copy`, {
      visible: source.visible,
      locked: source.locked,
    });
    const target = await showLayerDialog(suggestion, { mode: 'add', title: t('dialog.layerDuplicate') });
    if (!target) return;
    await this.run('history.duplicateLayer', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー複製', (document) => {
          // copyLayerContentsはlocked targetへの書込みを拒否する。複製結果としての
          // lock状態は保持しつつ、同一transaction内のコピー中だけ解除する。
          const requestedLocked = target.locked;
          target.locked = false;
          try {
            if (!document.addLayer(target)) throw new Error(t('msg.duplicateLayer'));
            this.options.copyContents(source, target);
            if (requestedLocked && !document.updateLayer(target, { locked: true })) {
              throw new Error('Layer not found');
            }
            document.shownLayer = target;
          } catch (error) {
            target.locked = requestedLocked;
            throw error;
          }
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
      await showMessageDialog(t('msg.noAdjacentLayer'));
      return;
    }
    if (target.locked) {
      await showMessageDialog(t('msg.targetLayerLocked'));
      return;
    }
    await this.run('history.copyLayerElements', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー要素コピー', () => this.options.copyContents(source, target)),
      );
    });
  }

  private async toggleVisibility(layer: Layer): Promise<void> {
    await this.run('history.layerVisibility', () => {
      this.options.document.execute(
        new UpdateLayersCommand(
          'レイヤー表示変更',
          (document) => void document.updateLayer(layer, { visible: !layer.visible }),
        ),
      );
    });
  }

  private async toggleLocked(layer: Layer): Promise<void> {
    await this.run('history.layerLock', () => {
      this.options.document.execute(
        new UpdateLayersCommand(
          'レイヤーロック変更',
          (document) => void document.updateLayer(layer, { locked: !layer.locked }),
        ),
      );
    });
  }

  private async isolate(layer: Layer): Promise<void> {
    await this.run('history.isolateLayer', () => {
      this.options.document.execute(
        new UpdateLayersCommand('レイヤー隔離', (document) => void document.isolateLayer(layer)),
      );
    });
  }

  private async showAll(): Promise<void> {
    await this.run('history.showAllLayers', () => {
      this.options.document.execute(new UpdateLayersCommand('全レイヤー表示', (document) => document.showAllLayers()));
    });
  }

  private async run(label: HistoryMessageKey, action: () => void): Promise<void> {
    // レイヤー変更は作業面・編集可否・表示対象を変えるため、どの入口からでも
    // mutation直前に作図中のanchor/previewを共通境界で破棄する。
    this.options.cancelOperation();
    try {
      await this.options.trackChange(label, action);
      this.render();
      this.options.cadView.renderElements();
    } catch (error) {
      await showMessageDialog(t('msg.layerOperationFailed', { message: (error as Error).message }), {
        level: 'error',
      });
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
      if (label) {
        label.textContent = layer.name;
        label.title = formatLayerLabel(layer);
      }
      const height = item.querySelector<HTMLElement>('.layer-height');
      if (height) height.textContent = formatLayerHeight(layer);
      const visibility = item.querySelector<HTMLButtonElement>('[data-action="visibility"]');
      if (visibility) {
        visibility.textContent = layer.visible ? '◉' : '○';
        setActionLabel(visibility, t(layer.visible ? 'layer.hide' : 'layer.show'));
      }
      const lock = item.querySelector<HTMLButtonElement>('[data-action="lock"]');
      if (lock) {
        lock.textContent = layer.locked ? '🔒' : '🔓';
        setActionLabel(lock, t(layer.locked ? 'layer.unlock' : 'layer.lock'));
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

  /** 直前の階高（最上階と直下階の差）。レイヤーが1つ以下なら既定値。 */
  private typicalStoryHeight(): number {
    const layers = this.options.document.layers;
    if (layers.length < 2) return DEFAULT_STORY_HEIGHT;
    const height = layers[layers.length - 1].posZ - layers[layers.length - 2].posZ;
    return height > Z_TOLERANCE ? height : DEFAULT_STORY_HEIGHT;
  }

  /** 「3F」のように、階数の次の番号から名前を提案する。 */
  private nextLayerName(): string {
    const used = new Set(this.options.document.layers.map((layer) => layer.name));
    let index = this.options.document.layers.length + 1;
    while (used.has(`${index}F`)) index++;
    return `${index}F`;
  }

  /** 複製先の既定高さ。既存レイヤーと重複しない高さ（最上階 + 階高）を提案する。 */
  private suggestDuplicateZ(source: Layer): number {
    const layers = this.options.document.layers;
    const height = this.typicalStoryHeight();
    let z = source.posZ + height;
    const occupied = (value: number): boolean => layers.some((layer) => Math.abs(layer.posZ - value) <= Z_TOLERANCE);
    const top = layers[layers.length - 1]?.posZ ?? source.posZ;
    if (occupied(z)) z = top + height;
    while (occupied(z)) z += height;
    return z;
  }
}

function setActionLabel(button: HTMLButtonElement, label: string): void {
  button.setAttribute('aria-label', label);
  button.title = label;
}

/** data層のLayerへ表示責務を戻さないためのUI formatter。 */
export function formatLayerLabel(layer: Layer): string {
  return `${layer.name} : ${layer.posZ}`;
}

export function formatLayerHeight(layer: Layer): string {
  return `${layer.posZ}`;
}
