import * as Slider from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

const toolbarSliderThumbClassName =
  'block size-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const toolbarSliderTrackClassName = 'relative h-1.5 w-full grow rounded-full bg-secondary';
const toolbarSliderRangeClassName = 'absolute h-full rounded-full bg-primary';

interface FloatingToolbarSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  className?: string;
  thumbClassName?: string;
  onValueCommit?: () => void;
  onPointerDownCapture?: () => void;
  onFocusCapture?: () => void;
  onBlurCapture?: () => void;
}

export function FloatingToolbarSlider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  className,
  thumbClassName,
  onValueCommit,
  onPointerDownCapture,
  onFocusCapture,
  onBlurCapture,
}: FloatingToolbarSliderProps) {
  return (
    <Slider.Root
      className={cn('relative flex h-4 w-full touch-none items-center', className)}
      value={[value]}
      onValueChange={([nextValue]) => onValueChange(nextValue)}
      onValueCommit={onValueCommit}
      onPointerDownCapture={onPointerDownCapture}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      min={min}
      max={max}
      step={step}
    >
      <Slider.Track className={toolbarSliderTrackClassName}>
        <Slider.Range className={toolbarSliderRangeClassName} />
      </Slider.Track>
      <Slider.Thumb className={cn(toolbarSliderThumbClassName, thumbClassName)} />
    </Slider.Root>
  );
}
