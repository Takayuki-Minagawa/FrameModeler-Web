const THEME_KEY = 'framemodeler-theme';

/** 永続設定とDOMへの適用を一か所に集約する。 */
export class SettingsStore {
  constructor(
    private readonly root: Document = document,
    private readonly storage: Storage = localStorage,
  ) {}

  initializeTheme(): void {
    if (this.storage.getItem(THEME_KEY) === 'dark') this.root.documentElement.dataset.theme = 'dark';
    this.updateThemeButton();
  }

  toggleTheme(): boolean {
    if (this.isDark) {
      delete this.root.documentElement.dataset.theme;
      this.storage.removeItem(THEME_KEY);
    } else {
      this.root.documentElement.dataset.theme = 'dark';
      this.storage.setItem(THEME_KEY, 'dark');
    }
    this.updateThemeButton();
    return this.isDark;
  }

  get isDark(): boolean {
    return this.root.documentElement.dataset.theme === 'dark';
  }

  private updateThemeButton(): void {
    const button = this.root.getElementById('btn-theme');
    if (button) button.textContent = this.isDark ? '\u2600' : '\u263E';
  }
}
