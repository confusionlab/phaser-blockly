import * as React from 'react';

import { cn } from '@/lib/utils';

type OverlayPillTone = 'dark' | 'light';
type OverlayPillSize = 'default' | 'compact';

interface OverlayPillProps extends React.ComponentProps<'div'> {
  tone?: OverlayPillTone;
  size?: OverlayPillSize;
}

export function OverlayPill({
  className,
  tone = 'dark',
  size = 'default',
  ...props
}: OverlayPillProps) {
  return (
    <div
      data-slot="overlay-pill"
      className={cn(
        'inline-flex items-center rounded-full border backdrop-blur-md',
        size === 'compact' ? 'gap-0.5 p-0.5' : 'gap-1 p-1',
        tone === 'dark'
          ? 'border-white/12 bg-black/58 text-white shadow-[0_14px_36px_-18px_rgba(0,0,0,0.72)]'
          : 'border-border/70 bg-background/92 text-foreground shadow-[0_14px_36px_-18px_rgba(15,23,42,0.28)]',
        className,
      )}
      {...props}
    />
  );
}
