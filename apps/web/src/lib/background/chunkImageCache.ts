import {
  getCachedImageSource,
  loadImageSource,
} from '@/lib/assets/imageSourceCache';

export function getCachedBackgroundChunkImage(source: string): HTMLImageElement | null {
  return getCachedImageSource(source);
}

export function decodeBackgroundChunkImage(source: string): Promise<HTMLImageElement> {
  return loadImageSource(source);
}
