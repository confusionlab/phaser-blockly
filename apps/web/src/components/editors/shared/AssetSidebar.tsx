import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

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

      <ScrollArea className="flex-1">
        <div className={cn('p-2', contentClassName)}>
          {children}
        </div>
      </ScrollArea>
    </aside>
  );
}
