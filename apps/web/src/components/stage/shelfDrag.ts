let transparentDragImage: HTMLImageElement | null = null;

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
