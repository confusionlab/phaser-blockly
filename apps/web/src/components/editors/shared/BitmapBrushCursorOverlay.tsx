import { forwardRef } from 'react';

interface BitmapBrushCursorOverlayProps {
  testId?: string;
  zIndex?: number;
}

export const BitmapBrushCursorOverlay = forwardRef<HTMLDivElement, BitmapBrushCursorOverlayProps>(function BitmapBrushCursorOverlay(
  {
    testId,
    zIndex = 40,
  },
  ref,
) {
  return (
    <div
      ref={ref}
      data-testid={testId}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 12,
        height: 12,
        borderRadius: '9999px',
        border: '1.5px solid #111111',
        background: 'rgba(255,255,255,0.1)',
        boxShadow: 'none',
        transform: 'translate(-9999px, -9999px)',
        opacity: 0,
        pointerEvents: 'none',
        zIndex,
      }}
    />
  );
});
