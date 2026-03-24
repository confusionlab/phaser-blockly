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
          : 'border-white/45 bg-white/36 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_14px_36px_-18px_rgba(15,23,42,0.22)] backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  );
}
