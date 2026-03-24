import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FloatingBottomToolbarVariant = 'property' | 'tool';

interface FloatingBottomToolbarDockProps {
  children: ReactNode;
  className?: string;
  stackClassName?: string;
}

interface FloatingBottomToolbarProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  variant?: FloatingBottomToolbarVariant;
  testId?: string;
}

const floatingBarChromeClass =
  'pointer-events-auto max-w-full border border-border/70 bg-background/95 backdrop-blur-xl dark:bg-background';

const variantClassName: Record<FloatingBottomToolbarVariant, string> = {
  property:
    'rounded-[24px] px-3 py-2 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45),0_6px_18px_-14px_rgba(15,23,42,0.24)] dark:shadow-[0_24px_64px_-38px_rgba(0,0,0,0.8),0_6px_18px_-14px_rgba(0,0,0,0.52)]',
  tool:
    'rounded-[28px] p-2 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.5),0_8px_20px_-16px_rgba(15,23,42,0.28)] dark:shadow-[0_28px_72px_-38px_rgba(0,0,0,0.8),0_8px_24px_-18px_rgba(0,0,0,0.6)]',
};

export function FloatingBottomToolbarDock({
  children,
  className,
  stackClassName,
}: FloatingBottomToolbarDockProps) {
  return (
    <div className={cn('pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4', className)}>
      <div className={cn('flex max-w-full flex-col items-center gap-3', stackClassName)}>
        {children}
      </div>
    </div>
  );
}

export function FloatingBottomToolbar({
  children,
  className,
  contentClassName,
  variant = 'tool',
  testId,
}: FloatingBottomToolbarProps) {
  return (
    <div className={cn(floatingBarChromeClass, variantClassName[variant], className)} data-testid={testId}>
      <div className={cn('hide-scrollbar max-w-full overflow-x-auto overflow-y-visible', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
