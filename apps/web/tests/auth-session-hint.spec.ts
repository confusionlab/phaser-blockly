import { expect, test } from '@playwright/test';

import {
  clearAuthenticatedSessionHint,
  hasRecentAuthenticatedSessionHint,
  persistAuthenticatedSessionHint,
  shouldWarmStartProjectExplorer,
} from '../src/lib/authSessionHint';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test.describe('auth session hint', () => {
  test('tracks a recent authenticated session hint', () => {
    const storage = new MemoryStorage();
    const now = 1_700_000_000_000;

    expect(hasRecentAuthenticatedSessionHint(storage, now)).toBe(false);

    persistAuthenticatedSessionHint(storage, now);

    expect(hasRecentAuthenticatedSessionHint(storage, now + 60_000)).toBe(true);

    clearAuthenticatedSessionHint(storage);

    expect(hasRecentAuthenticatedSessionHint(storage, now + 60_000)).toBe(false);
  });

  test('expires stale or invalid session hints', () => {
    const storage = new MemoryStorage();
    const now = 1_700_000_000_000;

    persistAuthenticatedSessionHint(storage, now - (8 * 24 * 60 * 60 * 1000));
    expect(hasRecentAuthenticatedSessionHint(storage, now)).toBe(false);

    storage.setItem('pochacoding-auth-session-hint', '{"version":1,"lastAuthenticatedAt":"bad"}');
    expect(hasRecentAuthenticatedSessionHint(storage, now)).toBe(false);
  });

  test('only warm starts the cached explorer for the signed-in home route while auth is loading', () => {
    expect(shouldWarmStartProjectExplorer({
      hasRecentSessionHint: true,
      isAuthenticated: false,
      isLoading: true,
      pathname: '/',
    })).toBe(true);

    expect(shouldWarmStartProjectExplorer({
      hasRecentSessionHint: true,
      isAuthenticated: false,
      isLoading: true,
      pathname: '/project/demo',
    })).toBe(false);

    expect(shouldWarmStartProjectExplorer({
      hasRecentSessionHint: false,
      isAuthenticated: false,
      isLoading: true,
      pathname: '/',
    })).toBe(false);

    expect(shouldWarmStartProjectExplorer({
      hasRecentSessionHint: true,
      isAuthenticated: true,
      isLoading: false,
      pathname: '/',
    })).toBe(false);
  });
});
