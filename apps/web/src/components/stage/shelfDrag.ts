import { useEffect, type RefObject } from 'react';

let transparentDragImage: HTMLImageElement | null = null;
let draggedComponentId: string | null = null;

export type ShelfDropPosition = 'before' | 'after' | 'on';

export function getTransparentShelfDragImage(): HTMLImageElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  if (transparentDragImage) {
    return transparentDragImage;
  }

  const image = document.createElement('img');
  image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  image.alt = '';
  image.width = 1;
  image.height = 1;
  image.setAttribute('aria-hidden', 'true');
  image.style.position = 'fixed';
  image.style.left = '-9999px';
  image.style.top = '-9999px';
  image.style.pointerEvents = 'none';
  image.style.opacity = '0';
  document.body.appendChild(image);
  transparentDragImage = image;
  return transparentDragImage;
}

export function getShelfRowDropPosition(options: {
  isFolder: boolean;
  isExpandedFolder: boolean;
  clientY: number;
  rect: DOMRect;
}): ShelfDropPosition {
  const { isFolder, isExpandedFolder, clientY, rect } = options;
  if (!isFolder) {
    return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  const relativeY = clientY - rect.top;
  const topZone = rect.height * 0.25;
  const bottomZone = rect.height * 0.75;

  if (relativeY < topZone) {
    return 'before';
  }
  if (!isExpandedFolder && relativeY > bottomZone) {
    return 'after';
  }
  return 'on';
}

export function isClientPointInsideRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): boolean {
  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom;
}

export function useShelfDropTargetBoundaryGuard(options: {
  active: boolean;
  boundaryRef: RefObject<HTMLElement | null>;
  onExit: () => void;
}): void {
  const { active, boundaryRef, onExit } = options;

  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return;
    }

    const handleWindowDragOver = (event: DragEvent) => {
      const boundary = boundaryRef.current;
      if (!boundary) {
        onExit();
        return;
      }

      const rect = boundary.getBoundingClientRect();
      if (!isClientPointInsideRect(event.clientX, event.clientY, rect)) {
        onExit();
      }
    };

    const handleWindowDragEnd = () => {
      onExit();
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragend', handleWindowDragEnd);
    window.addEventListener('drop', handleWindowDragEnd);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragend', handleWindowDragEnd);
      window.removeEventListener('drop', handleWindowDragEnd);
    };
  }, [active, boundaryRef, onExit]);
}

export function setDraggedComponentId(componentId: string | null): void {
  draggedComponentId = componentId;
}

export function getDraggedComponentId(): string | null {
  return draggedComponentId;
}
