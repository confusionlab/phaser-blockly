import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AssetSidebarProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function AssetSidebar({
  title,
  actions,
  children,
  className,
  contentClassName,
}: AssetSidebarProps) {
  return (
    <aside className={cn('flex h-full w-48 flex-col border-r bg-muted/30', className)}>
      <div className="flex items-center justify-between border-b px-2 py-2">
        <span className="text-xs font-medium">{title}</span>
        {actions ? <div className="flex gap-1">{actions}</div> : null}
      </div>

      <div className={cn('scrollbar-gutter-stable flex-1 overflow-y-auto p-2', contentClassName)}>
        {children}
      </div>
    </aside>
  );
}
