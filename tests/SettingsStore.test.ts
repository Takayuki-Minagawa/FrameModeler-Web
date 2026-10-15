// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_FLAG_DEFAULTS, SettingsStore } from '../src/controllers/SettingsStore';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = '<button id="btn-theme"></button>';
});

describe('SettingsStore', () => {
  it('starts from the defaults, persists flags and notifies subscribers', () => {
    const store = new SettingsStore();
    for (const [flag, value] of Object.entries(APP_FLAG_DEFAULTS)) {
      expect(store.getFlag(flag as keyof typeof APP_FLAG_DEFAULTS)).toBe(value);
    }
    const listener = vi.fn();
    store.subscribe(listener);
    store.setFlag('confirmDelete', false);
    store.setFlag('confirmDelete', false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('confirmDelete', false);

    const reloaded = new SettingsStore();
    expect(reloaded.getFlag('confirmDelete')).toBe(false);
    expect(reloaded.getFlag('fitOnViewChange')).toBe(true);
  });

  it('ignores corrupt or foreign stored values', () => {
    localStorage.setItem('framemodeler-settings', '{"confirmDelete":"no","other":true');
    expect(new SettingsStore().getFlag('confirmDelete')).toBe(true);
    localStorage.setItem('framemodeler-settings', '{"confirmDelete":"no","openPropertiesOnCreate":false}');
    const store = new SettingsStore();
    expect(store.getFlag('confirmDelete')).toBe(true);
    expect(store.getFlag('openPropertiesOnCreate')).toBe(false);
  });

  it('applies the theme explicitly and through toggling', () => {
    const store = new SettingsStore();
    store.setTheme(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('framemodeler-theme')).toBe('dark');
    expect(document.getElementById('btn-theme')?.textContent).toBe('☀');
    expect(store.toggleTheme()).toBe(false);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('framemodeler-theme')).toBeNull();
  });
});
