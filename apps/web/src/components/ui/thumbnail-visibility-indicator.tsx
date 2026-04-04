import { EyeOff } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

interface ThumbnailVisibilityIndicatorProps {
  visible?: boolean;
  testId?: string;
  className?: string;
}

export function ThumbnailVisibilityIndicator({
  visible = true,
  testId,
  className,
}: ThumbnailVisibilityIndicatorProps) {
  if (visible) {
    return null;
  }

  return (
    <div
      data-testid={testId}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-20 flex items-center justify-center',
        className,
      )}
    >
      <div className="flex size-5 items-center justify-center rounded-full border border-background/80 bg-surface-floating/95 text-foreground shadow-[0_2px_6px_rgba(15,23,42,0.2)]">
        <EyeOff className="size-3" />
      </div>
    </div>
  );
}
