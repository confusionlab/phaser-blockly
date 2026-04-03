import type { ComponentProps } from 'react';
import { ClerkProvider } from '@clerk/clerk-react';
import { dark } from '@clerk/themes';

export type ClerkColorMode = 'light' | 'dark';

type ClerkAppearance = NonNullable<ComponentProps<typeof ClerkProvider>['appearance']>;

const CLERK_VARIABLES: NonNullable<ClerkAppearance['variables']> = {
  borderRadius: 'var(--radius)',
  colorBackground: 'var(--card)',
  colorBorder: 'var(--border)',
  colorDanger: 'var(--destructive)',
  colorForeground: 'var(--foreground)',
  colorInput: 'var(--background)',
  colorInputForeground: 'var(--foreground)',
  colorMuted: 'var(--muted)',
  colorMutedForeground: 'var(--muted-foreground)',
  colorNeutral: 'var(--foreground)',
  colorPrimary: 'var(--primary)',
  colorPrimaryForeground: 'var(--primary-foreground)',
  colorRing: 'var(--ring)',
  fontFamily: 'var(--font-sans)',
  fontFamilyButtons: 'var(--font-sans)',
};

export function createClerkAppearance(colorMode: ClerkColorMode): ClerkAppearance {
  return {
    captcha: {
      theme: colorMode,
    },
    theme: colorMode === 'dark' ? dark : 'clerk',
    variables: CLERK_VARIABLES,
  };
}
