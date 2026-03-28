import { expect, test } from '@playwright/test';

import { shouldWarmStartProjectExplorer } from '../src/lib/authWarmStart';

test.describe('auth warm start', () => {
  test('warm starts the cached explorer only after Clerk confirms a signed-in session', () => {
    expect(shouldWarmStartProjectExplorer({
      clerkLoaded: true,
      clerkSignedIn: true,
      convexAuthenticated: false,
      convexLoading: true,
      pathname: '/',
    })).toBe(true);
  });

  test('does not warm start while Clerk is still loading or signed out', () => {
    expect(shouldWarmStartProjectExplorer({
      clerkLoaded: false,
      clerkSignedIn: false,
      convexAuthenticated: false,
      convexLoading: true,
      pathname: '/',
    })).toBe(false);

    expect(shouldWarmStartProjectExplorer({
      clerkLoaded: true,
      clerkSignedIn: false,
      convexAuthenticated: false,
      convexLoading: true,
      pathname: '/',
    })).toBe(false);
  });

  test('does not warm start once Convex is resolved or outside the home route', () => {
    expect(shouldWarmStartProjectExplorer({
      clerkLoaded: true,
      clerkSignedIn: true,
      convexAuthenticated: true,
      convexLoading: false,
      pathname: '/',
    })).toBe(false);

    expect(shouldWarmStartProjectExplorer({
      clerkLoaded: true,
      clerkSignedIn: true,
      convexAuthenticated: false,
      convexLoading: true,
      pathname: '/project/demo',
    })).toBe(false);
  });
});
