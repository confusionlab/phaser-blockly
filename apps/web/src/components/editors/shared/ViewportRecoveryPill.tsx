import { OverlayPill } from '@/components/ui/overlay-pill';
import { cn } from '@/lib/utils';

interface ViewportRecoveryPillProps {
  className?: string;
  dataTestId?: string;
  label?: string;
  onClick: () => void;
  visible: boolean;
}

export function ViewportRecoveryPill({
  className,
  dataTestId,
  label = 'Return to center',
  onClick,
  visible,
}: ViewportRecoveryPillProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className={cn('pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3', className)}>
      <OverlayPill tone="dark" size="compact" className="pointer-events-auto px-1 py-1">
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-xs font-medium text-white/88 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55"
          data-testid={dataTestId}
          onClick={onClick}
        >
          {label}
        </button>
      </OverlayPill>
    </div>
  );
}
