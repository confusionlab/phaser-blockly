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

export function setDraggedComponentId(componentId: string | null): void {
  draggedComponentId = componentId;
}

export function getDraggedComponentId(): string | null {
  return draggedComponentId;
}
