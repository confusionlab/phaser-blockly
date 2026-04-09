import Phaser from 'phaser';

export interface TouchPixelMask {
  width: number;
  height: number;
  opaquePixelCount: number;
  bits: Uint32Array;
}

const MAX_TOUCH_MASK_CACHE_SIZE = 256;
const touchMaskCache = new Map<string, TouchPixelMask>();

function makeTouchMaskCacheKey(textureKey: string, frameName: string | number | null | undefined): string {
  return `${textureKey}::${String(frameName ?? '__BASE__')}`;
}

function readBit(bits: Uint32Array, index: number): boolean {
  return ((bits[index >>> 5] >>> (index & 31)) & 1) === 1;
}

function writeBit(bits: Uint32Array, index: number): void {
  bits[index >>> 5] |= (1 << (index & 31));
}

function rememberTouchMask(cacheKey: string, mask: TouchPixelMask): TouchPixelMask {
  touchMaskCache.set(cacheKey, mask);
  if (touchMaskCache.size > MAX_TOUCH_MASK_CACHE_SIZE) {
    const oldestKey = touchMaskCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      touchMaskCache.delete(oldestKey);
    }
  }
  return mask;
}

export function getTouchPixelMask(
  scene: Phaser.Scene,
  textureKey: string,
  frameName?: string | number | null,
): TouchPixelMask | null {
  const cacheKey = makeTouchMaskCacheKey(textureKey, frameName);
  const cached = touchMaskCache.get(cacheKey);
  if (cached) {
    touchMaskCache.delete(cacheKey);
    touchMaskCache.set(cacheKey, cached);
    return cached;
  }

  const textureManager = scene.textures;
  if (!textureManager?.exists(textureKey)) {
    return null;
  }

  const texture = textureManager.get(textureKey);
  const frame = frameName !== undefined && frameName !== null
    ? texture?.get(frameName)
    : texture?.get();
  if (!frame) {
    return null;
  }

  const width = Math.round((frame as { width?: number; cutWidth?: number }).width ?? (frame as { cutWidth?: number }).cutWidth ?? 0);
  const height = Math.round((frame as { height?: number; cutHeight?: number }).height ?? (frame as { cutHeight?: number }).cutHeight ?? 0);
  if (width <= 0 || height <= 0) {
    return null;
  }

  const bits = new Uint32Array(Math.ceil((width * height) / 32));
  const resolvedFrameName = (frame as { name?: string | number }).name ?? frameName ?? undefined;
  let opaquePixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = textureManager.getPixelAlpha(x, y, textureKey, resolvedFrameName);
      const isOpaque = alpha !== null && alpha !== undefined && alpha >= 1;
      if (isOpaque) {
        opaquePixelCount += 1;
        writeBit(bits, (y * width) + x);
      }
    }
  }

  return rememberTouchMask(cacheKey, {
    width,
    height,
    opaquePixelCount,
    bits,
  });
}

export function isTouchMaskPixelOpaque(mask: TouchPixelMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
    return false;
  }

  return readBit(mask.bits, (y * mask.width) + x);
}
