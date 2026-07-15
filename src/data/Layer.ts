export interface LayerOptions {
  /** 保存後も変化しないレイヤー識別子。 */
  id?: string;
  visible?: boolean;
  locked?: boolean;
}

/** 建物階（表示レイヤー）。データ層で管理し、UIから逆依存させない。 */
export class Layer {
  readonly id: string;
  posZ: number;
  name: string;
  visible: boolean;
  locked: boolean;

  constructor(z: number = 0, name: string = '新規レイヤー', options: LayerOptions = {}) {
    this.id = options.id ?? createLayerId();
    this.posZ = z;
    this.name = name;
    this.visible = options.visible ?? true;
    this.locked = options.locked ?? false;
  }

  clone(options: { preserveId?: boolean } = {}): Layer {
    return new Layer(this.posZ, this.name, {
      id: options.preserveId === false ? undefined : this.id,
      visible: this.visible,
      locked: this.locked,
    });
  }

  equals(other: Layer): boolean {
    return this.posZ === other.posZ;
  }

  compareTo(other: Layer): number {
    if (this.posZ < other.posZ) return -1;
    if (this.posZ > other.posZ) return +1;
    return 0;
  }
}

function createLayerId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `layer-${uuid}`;
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
