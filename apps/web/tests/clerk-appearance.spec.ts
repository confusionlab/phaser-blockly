import { expect, test } from '@playwright/test';
import { dark } from '@clerk/themes';

import { createClerkAppearance } from '../src/lib/clerkAppearance';

test.describe('clerk appearance', () => {
  test('uses the default Clerk theme in light mode with app tokens', () => {
    const appearance = createClerkAppearance('light');

    expect(appearance.theme).toBe('clerk');
    expect(appearance.captcha?.theme).toBe('light');
    expect(appearance.variables).toMatchObject({
      borderRadius: 'var(--radius)',
      colorBackground: 'var(--card)',
      colorForeground: 'var(--foreground)',
      colorInput: 'var(--background)',
      colorPrimary: 'var(--primary)',
      fontFamily: 'var(--font-sans)',
    });
  });

  test('switches Clerk to its dark base theme in dark mode', () => {
    const appearance = createClerkAppearance('dark');

    expect(appearance.theme).toBe(dark);
    expect(appearance.captcha?.theme).toBe('dark');
    expect(appearance.variables?.colorNeutral).toBe('var(--foreground)');
  });
});
