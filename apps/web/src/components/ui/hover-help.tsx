import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type HoverHelpAlign = 'start' | 'center' | 'end';
type HoverHelpSide = 'top' | 'bottom';

interface HoverHelpTriggerProps {
  label: string;
  className?: string;
}

function HoverHelpTrigger({ label, className }: HoverHelpTriggerProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn(
        'text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
      aria-label={label}
      aria-haspopup="dialog"
      type="button"
    >
      <span className="text-[11px] font-semibold">?</span>
    </Button>
  );
}

interface HoverHelpPanelProps {
  children: React.ReactNode;
  className?: string;
}

function HoverHelpPanel({ children, className }: HoverHelpPanelProps) {
  return (
    <div
      role="dialog"
      className={cn(
        'bg-popover text-popover-foreground w-[min(20rem,calc(100vw-2rem))] rounded-lg border p-3 shadow-lg',
        className,
      )}
      style={{ zIndex: 'var(--z-editor-popup)' }}
    >
      <div className="text-xs leading-5 text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

interface HoverHelpProps {
  label: string;
  children: React.ReactNode;
  align?: HoverHelpAlign;
  side?: HoverHelpSide;
  sideOffset?: number;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
}

export function HoverHelp({
  label,
  children,
  align = 'end',
  side = 'bottom',
  sideOffset = 8,
  className,
  triggerClassName,
  panelClassName,
}: HoverHelpProps) {
  const [open, setOpen] = React.useState(false);

  const alignmentClassName = align === 'start'
    ? 'left-0'
    : align === 'center'
      ? 'left-1/2 -translate-x-1/2'
      : 'right-0';
  const placementClassName = side === 'top' ? 'bottom-full' : 'top-full';

  return (
    <div
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <HoverHelpTrigger label={label} className={triggerClassName} />
      {open ? (
        <div
          className={cn('absolute z-50', placementClassName, alignmentClassName)}
          style={side === 'top' ? { marginBottom: sideOffset } : { marginTop: sideOffset }}
        >
          <HoverHelpPanel className={panelClassName}>
            {children}
          </HoverHelpPanel>
        </div>
      ) : null}
    </div>
  );
}
