import { util } from 'fabric';

export type BackgroundVectorCoordinateSpace = 'legacy-world-up' | 'scene-down';

export const BACKGROUND_VECTOR_COORDINATE_SPACE_KEY = 'backgroundVectorCoordinateSpace';
export const BACKGROUND_VECTOR_COORDINATE_SPACE_SCENE_DOWN = 'scene-down-v1';

export function parseBackgroundVectorFabricJson(fabricJson: string): {
  parsed: string | Record<string, any>;
  coordinateSpace: BackgroundVectorCoordinateSpace;
} {
  const parsed = JSON.parse(fabricJson) as string | Record<string, any>;
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    parsed[BACKGROUND_VECTOR_COORDINATE_SPACE_KEY] === BACKGROUND_VECTOR_COORDINATE_SPACE_SCENE_DOWN
  ) {
    return {
      parsed,
      coordinateSpace: 'scene-down',
    };
  }

  return {
    parsed,
    coordinateSpace: 'legacy-world-up',
  };
}

export function markBackgroundVectorSceneDownDocument(document: Record<string, any>): Record<string, any> {
  return {
    ...document,
    [BACKGROUND_VECTOR_COORDINATE_SPACE_KEY]: BACKGROUND_VECTOR_COORDINATE_SPACE_SCENE_DOWN,
  };
}

export function reflectBackgroundVectorObjectsAcrossXAxis(canvas: { getObjects: () => any[] }) {
  const reflectMatrix: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 0];

  for (const obj of canvas.getObjects()) {
    if (typeof obj?.calcTransformMatrix !== 'function') {
      continue;
    }

    const nextMatrix = util.multiplyTransformMatrices(reflectMatrix, obj.calcTransformMatrix());
    util.applyTransformToObject(obj, nextMatrix);
    obj.setCoords?.();
  }
}

export function getBackgroundVectorChunkViewportTransform(
  chunkBounds: { left: number; top: number },
  coordinateSpace: BackgroundVectorCoordinateSpace,
): [number, number, number, number, number, number] {
  if (coordinateSpace === 'scene-down') {
    return [1, 0, 0, 1, -chunkBounds.left, chunkBounds.top];
  }

  return [1, 0, 0, -1, -chunkBounds.left, chunkBounds.top];
}

export function toBackgroundVectorWorldY(
  coordinateSpace: BackgroundVectorCoordinateSpace,
  sceneY: number,
): number {
  return coordinateSpace === 'scene-down' ? -sceneY : sceneY;
}
