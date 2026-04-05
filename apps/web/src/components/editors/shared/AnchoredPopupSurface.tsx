import { createPortal } from 'react-dom';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { dropdownMenuContentClassName } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type PopupSide = 'top' | 'bottom';
type PopupAlign = 'start' | 'center' | 'end';

interface AnchoredPopupSurfaceProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  side?: PopupSide;
  align?: PopupAlign;
  sideOffset?: number;
  viewportPadding?: number;
}

export function AnchoredPopupSurface({
  open,
  anchorRef,
  onClose,
  children,
  className,
  side = 'top',
  align = 'center',
  sideOffset = 4,
  viewportPadding = 12,
}: AnchoredPopupSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, side });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const panelWidth = surfaceRef.current?.offsetWidth ?? 0;
    const panelHeight = surfaceRef.current?.offsetHeight ?? 0;

    let left = rect.left;
    if (align === 'center') {
      left = rect.left + rect.width / 2 - panelWidth / 2;
    } else if (align === 'end') {
      left = rect.right - panelWidth;
    }

    left = Math.max(
      viewportPadding,
      Math.min(left, window.innerWidth - panelWidth - viewportPadding),
    );

    const topCandidate = rect.top - panelHeight - sideOffset;
    const bottomCandidate = rect.bottom + sideOffset;
    const fitsAbove = topCandidate >= viewportPadding;
    const fitsBelow = bottomCandidate + panelHeight <= window.innerHeight - viewportPadding;
    const resolvedSide =
      side === 'top'
        ? (fitsAbove || !fitsBelow ? 'top' : 'bottom')
        : (fitsBelow || !fitsAbove ? 'bottom' : 'top');

    const nextPosition = {
      left,
      top: resolvedSide === 'top'
        ? Math.max(viewportPadding, topCandidate)
        : Math.min(bottomCandidate, window.innerHeight - panelHeight - viewportPadding),
      side: resolvedSide,
    } as const;

    setPosition((current) => (
      current.left === nextPosition.left &&
      current.top === nextPosition.top &&
      current.side === nextPosition.side
        ? current
        : nextPosition
    ));
  }, [align, anchorRef, side, sideOffset, viewportPadding]);

  useEffect(() => {
    if (!open) return;

    updatePosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target)) return;
      if (surfaceRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const handleViewportChange = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [anchorRef, onClose, open, updatePosition]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={surfaceRef}
      data-state="open"
      data-side={position.side}
      className={cn(dropdownMenuContentClassName, 'fixed', className)}
      style={{
        left: position.left,
        top: position.top,
        zIndex: 'var(--z-editor-popup)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
