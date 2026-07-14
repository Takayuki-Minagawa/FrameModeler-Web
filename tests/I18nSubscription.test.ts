// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, subscribeLocaleChanged } from '../src/i18n';

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
});
