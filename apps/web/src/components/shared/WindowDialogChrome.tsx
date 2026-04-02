import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface WindowDialogChromeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  windowClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  showCloseButton?: boolean;
}

export function WindowDialogChrome({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName,
  windowClassName,
  headerClassName,
  bodyClassName,
  showCloseButton = true,
}: WindowDialogChromeProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'h-[min(calc(100vh-2.5rem),960px)] max-h-[min(calc(100vh-2.5rem),960px)] w-[calc(100vw-2.5rem)] max-w-none border-none bg-transparent p-4 shadow-none [&>[data-slot=\'dialog-close\']]:top-7 [&>[data-slot=\'dialog-close\']]:right-7 sm:p-6 sm:[&>[data-slot=\'dialog-close\']]:top-10 sm:[&>[data-slot=\'dialog-close\']]:right-10',
          contentClassName,
        )}
        showCloseButton={showCloseButton}
      >
        <div
          className={cn(
            'flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-border/70 bg-card shadow-[0_40px_120px_-52px_rgba(15,23,42,0.58)]',
            windowClassName,
          )}
        >
          <div className={cn('shrink-0 border-b border-border/70 px-6 py-6 pr-16', headerClassName)}>
            <DialogHeader className="gap-2 text-left">
              <DialogTitle className="text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
                {title}
              </DialogTitle>
              {description ? (
                <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {description}
                </DialogDescription>
              ) : null}
            </DialogHeader>
          </div>

          <div className={cn('min-h-0 flex-1', bodyClassName)}>
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
