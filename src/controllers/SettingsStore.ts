const THEME_KEY = 'framemodeler-theme';
const FLAGS_KEY = 'framemodeler-settings';

/** 利用者が切り替えられる動作設定。すべて boolean で localStorage に保存する。 */
export type AppFlag = 'openPropertiesOnCreate' | 'confirmDelete' | 'removeOrphansOnDelete' | 'fitOnViewChange';

export const APP_FLAG_DEFAULTS: Readonly<Record<AppFlag, boolean>> = Object.freeze({
  openPropertiesOnCreate: true,
  confirmDelete: true,
  removeOrphansOnDelete: true,
  fitOnViewChange: true,
});

export type AppFlagListener = (flag: AppFlag, value: boolean) => void;

/** 永続設定とDOMへの適用を一か所に集約する。 */
export class SettingsStore {
  private flags: Record<AppFlag, boolean>;
  private readonly listeners = new Set<AppFlagListener>();

  constructor(
    private readonly root: Document = document,
    private readonly storage: Storage = localStorage,
  ) {
    this.flags = { ...APP_FLAG_DEFAULTS, ...this.readStoredFlags() };
  }

  initializeTheme(): void {
    if (this.storage.getItem(THEME_KEY) === 'dark') this.root.documentElement.dataset.theme = 'dark';
    this.updateThemeButton();
  }

  toggleTheme(): boolean {
    this.setTheme(!this.isDark);
    return this.isDark;
  }

  setTheme(dark: boolean): void {
    if (dark) {
      this.root.documentElement.dataset.theme = 'dark';
      this.storage.setItem(THEME_KEY, 'dark');
    } else {
      delete this.root.documentElement.dataset.theme;
      this.storage.removeItem(THEME_KEY);
    }
    this.updateThemeButton();
  }

  get isDark(): boolean {
    return this.root.documentElement.dataset.theme === 'dark';
  }

  getFlag(flag: AppFlag): boolean {
    return this.flags[flag];
  }

  setFlag(flag: AppFlag, value: boolean): void {
    if (this.flags[flag] === value) return;
    this.flags = { ...this.flags, [flag]: value };
    try {
      this.storage.setItem(FLAGS_KEY, JSON.stringify(this.flags));
    } catch {
      // 容量超過やプライベートモードでは保存できなくても動作は継続する。
    }
    for (const listener of [...this.listeners]) listener(flag, value);
  }

  subscribe(listener: AppFlagListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readStoredFlags(): Partial<Record<AppFlag, boolean>> {
    try {
      const raw = this.storage.getItem(FLAGS_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const result: Partial<Record<AppFlag, boolean>> = {};
      for (const key of Object.keys(APP_FLAG_DEFAULTS) as AppFlag[]) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'boolean') result[key] = value;
      }
      return result;
    } catch {
      return {};
    }
  }

  private updateThemeButton(): void {
    const button = this.root.getElementById('btn-theme');
    if (button) button.textContent = this.isDark ? '\u2600' : '\u263E';
  }
}
