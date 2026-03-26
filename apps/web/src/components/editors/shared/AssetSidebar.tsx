import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AssetSidebarProps {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function AssetSidebar({
  actions,
  children,
  className,
  contentClassName,
}: AssetSidebarProps) {
  return (
    <aside className={cn('flex h-full w-36 flex-col border-r bg-muted/30', className)}>
      {actions ? (
        <div className="flex items-center justify-center px-3 py-3">
          <div className="flex gap-1">{actions}</div>
        </div>
      ) : null}

      <ScrollArea className="flex-1">
        <div className={cn('p-2', contentClassName)}>
          {children}
        </div>
      </ScrollArea>
    </aside>
  );
}
