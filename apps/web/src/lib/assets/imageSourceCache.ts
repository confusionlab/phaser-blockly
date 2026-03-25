const MAX_CACHED_IMAGE_SOURCES = 512;

const resolvedImageSourceCache = new Map<string, HTMLImageElement>();
const pendingImageSourceCache = new Map<string, Promise<HTMLImageElement>>();

function rememberResolvedImageSource(source: string, image: HTMLImageElement): void {
  if (resolvedImageSourceCache.has(source)) {
    resolvedImageSourceCache.delete(source);
  }
  resolvedImageSourceCache.set(source, image);

  while (resolvedImageSourceCache.size > MAX_CACHED_IMAGE_SOURCES) {
    const oldestKey = resolvedImageSourceCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    resolvedImageSourceCache.delete(oldestKey);
  }
}

export function getCachedImageSource(source: string): HTMLImageElement | null {
  const cached = resolvedImageSourceCache.get(source) ?? null;
  if (!cached) {
    return null;
  }

  rememberResolvedImageSource(source, cached);
  return cached;
}

export function invalidateImageSource(source: string): void {
  resolvedImageSourceCache.delete(source);
  pendingImageSourceCache.delete(source);
}

export function loadImageSource(source: string): Promise<HTMLImageElement> {
  const cached = getCachedImageSource(source);
  if (cached) {
    return Promise.resolve(cached);
  }

  const pending = pendingImageSourceCache.get(source);
  if (pending) {
    return pending;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      pendingImageSourceCache.delete(source);
      rememberResolvedImageSource(source, image);
      resolve(image);
    };
    image.onerror = () => {
      pendingImageSourceCache.delete(source);
      reject(new Error(`Failed to load image source: ${source.slice(0, 96)}`));
    };
    image.src = source;
  });

  pendingImageSourceCache.set(source, promise);
  return promise;
}
