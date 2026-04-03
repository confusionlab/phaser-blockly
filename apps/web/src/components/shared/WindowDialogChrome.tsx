import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { XIcon } from '@/components/ui/icons';
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

const WINDOW_CHROME_RADIUS_PX = 32;
const WINDOW_CHROME_CLOSE_INSET_PX = Math.round(WINDOW_CHROME_RADIUS_PX * 0.625);

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
  const windowRef = useRef<HTMLDivElement | null>(null);
  const contentStyle = {
    '--window-chrome-radius': `${WINDOW_CHROME_RADIUS_PX}px`,
    '--window-close-inset': `${WINDOW_CHROME_CLOSE_INSET_PX}px`,
  } as CSSProperties;
  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    windowRef.current?.focus();
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'top-8 right-8 bottom-8 left-8 h-auto w-auto max-w-none translate-x-0 translate-y-0 rounded-none border-none bg-transparent p-0 shadow-none sm:max-w-none',
          contentClassName,
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        showCloseButton={false}
        style={contentStyle}
      >
        <div
          ref={windowRef}
          tabIndex={-1}
          className={cn(
            'relative flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--window-chrome-radius)] border border-border/70 bg-[var(--surface-dialog-workspace)] shadow-[0_40px_120px_-52px_rgba(15,23,42,0.58)] outline-none',
            windowClassName,
          )}
        >
          {showCloseButton ? (
            <DialogClose
              className="ring-offset-background focus:ring-ring absolute top-[var(--window-close-inset)] right-[var(--window-close-inset)] z-20 rounded-xs p-0 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogClose>
          ) : null}
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
