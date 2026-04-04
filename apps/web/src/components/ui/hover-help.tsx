import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type HoverHelpAlign = 'start' | 'center' | 'end';
type HoverHelpSide = 'top' | 'bottom';
const HOVER_HELP_VIEWPORT_PADDING_PX = 12;

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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<{
    left: number;
    top: number;
    side: HoverHelpSide;
    ready: boolean;
  }>({
    left: 0,
    top: 0,
    side,
    ready: false,
  });

  const maybeClose = React.useCallback((relatedTarget: EventTarget | null) => {
    const nextTarget = relatedTarget as Node | null;
    if (!nextTarget) {
      setOpen(false);
      return;
    }
    if (containerRef.current?.contains(nextTarget) || panelRef.current?.contains(nextTarget)) {
      return;
    }
    setOpen(false);
  }, []);

  const updatePosition = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;

    if (panelWidth <= 0 || panelHeight <= 0) {
      setPosition((current) => ({ ...current, ready: false }));
      return;
    }

    let left = rect.left;
    if (align === 'center') {
      left = rect.left + (rect.width / 2) - (panelWidth / 2);
    } else if (align === 'end') {
      left = rect.right - panelWidth;
    }

    left = Math.max(
      HOVER_HELP_VIEWPORT_PADDING_PX,
      Math.min(left, window.innerWidth - panelWidth - HOVER_HELP_VIEWPORT_PADDING_PX),
    );

    const topCandidate = rect.top - panelHeight - sideOffset;
    const bottomCandidate = rect.bottom + sideOffset;
    const fitsAbove = topCandidate >= HOVER_HELP_VIEWPORT_PADDING_PX;
    const fitsBelow = bottomCandidate + panelHeight <= window.innerHeight - HOVER_HELP_VIEWPORT_PADDING_PX;
    const resolvedSide =
      side === 'top'
        ? (fitsAbove || !fitsBelow ? 'top' : 'bottom')
        : (fitsBelow || !fitsAbove ? 'bottom' : 'top');
    const unclampedTop = resolvedSide === 'top' ? topCandidate : bottomCandidate;
    const top = Math.max(
      HOVER_HELP_VIEWPORT_PADDING_PX,
      Math.min(unclampedTop, window.innerHeight - panelHeight - HOVER_HELP_VIEWPORT_PADDING_PX),
    );

    setPosition({
      left,
      top,
      side: resolvedSide,
      ready: true,
    });
  }, [align, side, sideOffset]);

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
  }, [children, open, panelClassName, updatePosition]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePosition]);

  return (
    <div
      ref={containerRef}
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={(event) => maybeClose(event.relatedTarget)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => maybeClose(event.relatedTarget)}
    >
      <span ref={triggerRef}>
        <HoverHelpTrigger label={label} className={triggerClassName} />
      </span>
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-50"
          data-side={position.side}
          style={{
            left: position.left,
            top: position.top,
            visibility: position.ready ? 'visible' : 'hidden',
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={(event) => maybeClose(event.relatedTarget)}
          onFocusCapture={() => setOpen(true)}
          onBlurCapture={(event) => maybeClose(event.relatedTarget)}
        >
          <HoverHelpPanel className={panelClassName}>
            {children}
          </HoverHelpPanel>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
