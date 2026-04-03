import { Component } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

export function getObjectComponentLabelTextClassName(isComponent: boolean): string {
  return isComponent ? 'text-purple-700 dark:text-purple-300' : 'text-foreground';
}

interface ObjectComponentLabelProps {
  name: string;
  isComponent?: boolean;
  className?: string;
  title?: string;
}

export function ObjectComponentLabel({
  name,
  isComponent = false,
  className,
  title,
}: ObjectComponentLabelProps) {
  const labelClassName = getObjectComponentLabelTextClassName(isComponent);

  return (
    <div className={cn('flex w-full min-w-0 items-center gap-1 overflow-hidden', className)} title={title ?? name}>
      <span
        className={cn(
          'block min-w-0 flex-1 truncate text-xs leading-5',
          labelClassName,
        )}
      >
        {name}
      </span>
      {isComponent ? (
        <span className="flex shrink-0 items-center pr-1">
          <Component className={cn('size-3 shrink-0 opacity-60', labelClassName)} />
        </span>
      ) : null}
    </div>
  );
}
