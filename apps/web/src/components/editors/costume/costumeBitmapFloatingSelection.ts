export interface BitmapFloatingSelectionTransformSnapshot {
  angle: number;
  flipX: boolean;
  flipY: boolean;
  left: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  top: number;
}

const BITMAP_FLOATING_SELECTION_ORIGINAL_TRANSFORM_KEY = '__bitmapFloatingSelectionOriginalTransform';

export function captureBitmapFloatingSelectionTransform(target: any): BitmapFloatingSelectionTransformSnapshot {
  return {
    left: typeof target?.left === 'number' ? target.left : 0,
    top: typeof target?.top === 'number' ? target.top : 0,
    scaleX: typeof target?.scaleX === 'number' ? target.scaleX : 1,
    scaleY: typeof target?.scaleY === 'number' ? target.scaleY : 1,
    angle: typeof target?.angle === 'number' ? target.angle : 0,
    flipX: target?.flipX === true,
    flipY: target?.flipY === true,
    skewX: typeof target?.skewX === 'number' ? target.skewX : 0,
    skewY: typeof target?.skewY === 'number' ? target.skewY : 0,
  };
}

export function setBitmapFloatingSelectionOriginalTransform(target: any): void {
  if (!target) {
    return;
  }
  target[BITMAP_FLOATING_SELECTION_ORIGINAL_TRANSFORM_KEY] = captureBitmapFloatingSelectionTransform(target);
}

export function getBitmapFloatingSelectionOriginalTransform(
  target: any,
): BitmapFloatingSelectionTransformSnapshot | null {
  const snapshot = target?.[BITMAP_FLOATING_SELECTION_ORIGINAL_TRANSFORM_KEY];
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  return {
    left: typeof snapshot.left === 'number' ? snapshot.left : 0,
    top: typeof snapshot.top === 'number' ? snapshot.top : 0,
    scaleX: typeof snapshot.scaleX === 'number' ? snapshot.scaleX : 1,
    scaleY: typeof snapshot.scaleY === 'number' ? snapshot.scaleY : 1,
    angle: typeof snapshot.angle === 'number' ? snapshot.angle : 0,
    flipX: snapshot.flipX === true,
    flipY: snapshot.flipY === true,
    skewX: typeof snapshot.skewX === 'number' ? snapshot.skewX : 0,
    skewY: typeof snapshot.skewY === 'number' ? snapshot.skewY : 0,
  };
}

export function applyBitmapFloatingSelectionTransform(
  target: any,
  snapshot: BitmapFloatingSelectionTransformSnapshot,
): void {
  target?.set?.({
    left: snapshot.left,
    top: snapshot.top,
    scaleX: snapshot.scaleX,
    scaleY: snapshot.scaleY,
    angle: snapshot.angle,
    flipX: snapshot.flipX,
    flipY: snapshot.flipY,
    skewX: snapshot.skewX,
    skewY: snapshot.skewY,
  });
  target?.setCoords?.();
}
