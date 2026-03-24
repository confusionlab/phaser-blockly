import * as React from 'react';

import { cn } from '@/lib/utils';

type OverlayPillTone = 'dark' | 'light';

interface OverlayPillProps extends React.ComponentProps<'div'> {
  tone?: OverlayPillTone;
}

export function OverlayPill({
  className,
  tone = 'dark',
  ...props
}: OverlayPillProps) {
  return (
    <div
      data-slot="overlay-pill"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border p-1 backdrop-blur-md',
        tone === 'dark'
          ? 'border-white/12 bg-black/58 text-white shadow-[0_14px_36px_-18px_rgba(0,0,0,0.72)]'
          : 'border-border/70 bg-background/92 text-foreground shadow-[0_14px_36px_-18px_rgba(15,23,42,0.28)]',
        className,
      )}
      {...props}
    />
  );
}
