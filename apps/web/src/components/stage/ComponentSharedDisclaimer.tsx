import { Component } from '@/components/ui/icons';

interface ComponentSharedDisclaimerProps {
  className?: string;
}

export function ComponentSharedDisclaimer({ className }: ComponentSharedDisclaimerProps) {
  return (
    <div className={['flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2', className]
      .filter(Boolean)
      .join(' ')}
    >
      <Component className="size-4 text-purple-600" />
      <span className="min-w-0 text-xs text-muted-foreground">
        Components share code, costume, sound, and physics
      </span>
    </div>
  );
}
