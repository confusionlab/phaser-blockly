import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EditorToolbarProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function EditorToolbar({
  children,
  className,
  contentClassName,
}: EditorToolbarProps) {
  return (
    <div className={cn('border-b bg-background px-3 py-2', className)}>
      <div className={cn('hide-scrollbar flex items-center gap-2 overflow-x-auto overflow-y-hidden', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
