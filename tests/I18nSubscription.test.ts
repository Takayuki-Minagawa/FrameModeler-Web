// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, subscribeLocaleChanged, t, translateHistoryLabel } from '../src/i18n';

afterEach(() => setLocale('ja'));

describe('locale subscriptions', () => {
  it('notifies multiple independent listeners and supports unsubscribe', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeLocaleChanged(first);
    const unsubscribeSecond = subscribeLocaleChanged(second);

    setLocale('en');
    expect(first).toHaveBeenCalledWith('en');
    expect(second).toHaveBeenCalledWith('en');

    unsubscribeFirst();
    setLocale('ja');
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenLastCalledWith('ja');
    unsubscribeSecond();
  });

  it('centralizes snap names and translates stable history labels', () => {
    setLocale('en');
    expect(t('snap')).toBe('Snap');
    expect(t('snap.intersection')).toBe('Intersection');
    expect(translateHistoryLabel('history.propertyEdit')).toBe('Edit properties');

    setLocale('ja');
    expect(t('snap.horizontal')).toBe('画面水平');
    expect(translateHistoryLabel('history.deleteSelection')).toBe('選択要素削除');
    expect(translateHistoryLabel('custom operation')).toBe('custom operation');
  });
});
