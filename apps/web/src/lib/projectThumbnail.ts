import { loadImageSource } from '@/lib/assets/imageSourceCache';
import { getSceneBackgroundBaseColor } from '@/lib/background/compositor';
import { getCostumeBoundsInAssetSpace } from '@/lib/costume/costumeAssetFrame';
import type { Costume, Project, Scene } from '@/types';
import { getEffectiveObjectProps } from '@/types';
import { getSceneObjectsInLayerOrder } from '@/utils/layerTree';
import { getChunkWorldBounds, parseChunkKey } from '@/lib/background/chunkMath';

const MAX_THUMBNAIL_WIDTH = 480;
const MAX_THUMBNAIL_HEIGHT = 320;
const THUMBNAIL_TYPE = 'image/webp';
const THUMBNAIL_QUALITY = 0.9;
const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

export type ProjectThumbnailSource = Pick<Project, 'components' | 'scenes' | 'settings'>;

function pickPrimaryScene(project: Pick<Project, 'scenes'>): Scene | null {
  if (project.scenes.length === 0) {
    return null;
  }

  return project.scenes
    .slice()
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))[0] ?? null;
}

function getThumbnailCanvasSize(project: Project): { width: number; height: number; scale: number } {
  const sourceWidth = Math.max(1, Math.round(project.settings.canvasWidth));
  const sourceHeight = Math.max(1, Math.round(project.settings.canvasHeight));
  const scale = Math.min(
    1,
    MAX_THUMBNAIL_WIDTH / sourceWidth,
    MAX_THUMBNAIL_HEIGHT / sourceHeight,
  );

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

function computeContentHash(data: string): string {
  let hash = FNV64_OFFSET;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= BigInt(data.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function normalizeSignatureNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Number.parseFloat(value.toFixed(4));
}

function toBoundsFingerprint(bounds: Costume['bounds'] | undefined) {
  if (!bounds) {
    return null;
  }
  return {
    x: normalizeSignatureNumber(bounds.x),
    y: normalizeSignatureNumber(bounds.y),
    width: normalizeSignatureNumber(bounds.width),
    height: normalizeSignatureNumber(bounds.height),
  };
}

function toAssetFrameFingerprint(assetFrame: Costume['assetFrame'] | undefined) {
  if (!assetFrame) {
    return null;
  }
  return {
    x: normalizeSignatureNumber(assetFrame.x),
    y: normalizeSignatureNumber(assetFrame.y),
    width: normalizeSignatureNumber(assetFrame.width),
    height: normalizeSignatureNumber(assetFrame.height),
    sourceWidth: normalizeSignatureNumber(assetFrame.sourceWidth),
    sourceHeight: normalizeSignatureNumber(assetFrame.sourceHeight),
  };
}

function toCostumeFingerprint(costume: Costume | null) {
  if (!costume) {
    return null;
  }
  return {
    assetId: costume.assetId,
    persistedAssetId: costume.persistedAssetId ?? null,
    renderSignature: costume.renderSignature ?? null,
    bounds: toBoundsFingerprint(costume.bounds),
    assetFrame: toAssetFrameFingerprint(costume.assetFrame),
  };
}

function toBackgroundFingerprint(scene: Scene) {
  const background = scene.background;
  if (!background) {
    return null;
  }

  if (background.type === 'image') {
    return {
      type: background.type,
      value: background.value,
    };
  }

  if (background.type === 'tiled') {
    return {
      type: background.type,
      chunkSize: normalizeSignatureNumber(background.chunkSize ?? 0),
      chunks: Object.entries(background.chunks ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chunkKey, assetId]) => [chunkKey, assetId]),
    };
  }

  return {
    type: background.type,
    value: background.value,
  };
}

function toGroundFingerprint(scene: Scene) {
  if (!scene.ground?.enabled) {
    return null;
  }

  return {
    color: scene.ground.color ?? '#7c5c3e',
    y: normalizeSignatureNumber(scene.ground.y),
  };
}

function toCameraBoundsFingerprint(scene: Scene) {
  const bounds = scene.cameraConfig.bounds;
  if (!bounds) {
    return null;
  }

  return {
    x: normalizeSignatureNumber(bounds.x),
    y: normalizeSignatureNumber(bounds.y),
    width: normalizeSignatureNumber(bounds.width),
    height: normalizeSignatureNumber(bounds.height),
  };
}

function normalizeThumbnailCameraZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return normalizeSignatureNumber(Math.max(0.01, value));
}

export function computeProjectThumbnailVisualSignature(project: ProjectThumbnailSource): string | null {
  const primaryScene = pickPrimaryScene(project);
  if (!primaryScene) {
    return null;
  }

  const orderedObjects = getSceneObjectsInLayerOrder(primaryScene);
  const fingerprint = {
    canvas: {
      width: normalizeSignatureNumber(project.settings.canvasWidth),
      height: normalizeSignatureNumber(project.settings.canvasHeight),
    },
    camera: {
      followTarget: primaryScene.cameraConfig.followTarget ?? null,
      zoom: normalizeThumbnailCameraZoom(primaryScene.cameraConfig.zoom),
      bounds: toCameraBoundsFingerprint(primaryScene),
    },
    background: toBackgroundFingerprint(primaryScene),
    ground: toGroundFingerprint(primaryScene),
    objects: orderedObjects.map((object) => {
      const effectiveProps = getEffectiveObjectProps(object, project.components);
      const costume = effectiveProps.costumes[effectiveProps.currentCostumeIndex] ?? effectiveProps.costumes[0] ?? null;

      return {
        x: normalizeSignatureNumber(object.x),
        y: normalizeSignatureNumber(object.y),
        scaleX: normalizeSignatureNumber(object.scaleX),
        scaleY: normalizeSignatureNumber(object.scaleY),
        rotation: normalizeSignatureNumber(object.rotation),
        visible: object.visible,
        costume: toCostumeFingerprint(costume),
      };
    }),
  };

  return computeContentHash(JSON.stringify(fingerprint));
}

function userToCanvasPoint(x: number, y: number, canvasWidth: number, canvasHeight: number) {
  return {
    x: x + canvasWidth / 2,
    y: canvasHeight / 2 - y,
  };
}

function getCameraBoundsInCanvasSpace(
  scene: Scene,
  canvasWidth: number,
  canvasHeight: number,
): { left: number; top: number; right: number; bottom: number; width: number; height: number; centerX: number; centerY: number } | null {
  const bounds = scene.cameraConfig.bounds;
  if (!bounds) {
    return null;
  }

  const width = Math.max(1, normalizeSignatureNumber(bounds.width));
  const height = Math.max(1, normalizeSignatureNumber(bounds.height));
  const left = normalizeSignatureNumber(bounds.x) + canvasWidth / 2;
  const top = canvasHeight / 2 - normalizeSignatureNumber(bounds.y);
  const right = left + width;
  const bottom = top + height;

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function clampCameraCenterToBounds(
  center: { x: number; y: number },
  bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number; centerX: number; centerY: number },
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number } {
  const minX = bounds.left + viewWidth / 2;
  const maxX = bounds.right - viewWidth / 2;
  const minY = bounds.top + viewHeight / 2;
  const maxY = bounds.bottom - viewHeight / 2;

  return {
    x: minX <= maxX ? Math.min(Math.max(center.x, minX), maxX) : bounds.centerX,
    y: minY <= maxY ? Math.min(Math.max(center.y, minY), maxY) : bounds.centerY,
  };
}

function getThumbnailCameraSnapshot(
  project: Project,
  scene: Scene,
): { centerX: number; centerY: number; zoom: number } {
  const canvasWidth = Math.max(1, Math.round(project.settings.canvasWidth));
  const canvasHeight = Math.max(1, Math.round(project.settings.canvasHeight));
  const zoom = normalizeThumbnailCameraZoom(scene.cameraConfig.zoom);
  const viewWidth = canvasWidth / zoom;
  const viewHeight = canvasHeight / zoom;

  let center = {
    x: canvasWidth / 2,
    y: canvasHeight / 2,
  };

  const followTargetId = scene.cameraConfig.followTarget;
  if (followTargetId) {
    const followedObject = scene.objects.find((object) => object.id === followTargetId) ?? null;
    if (followedObject) {
      center = userToCanvasPoint(followedObject.x, followedObject.y, canvasWidth, canvasHeight);
    }
  }

  const bounds = getCameraBoundsInCanvasSpace(scene, canvasWidth, canvasHeight);
  if (bounds) {
    center = clampCameraCenterToBounds(center, bounds, viewWidth, viewHeight);
  }

  return {
    centerX: center.x,
    centerY: center.y,
    zoom,
  };
}

async function drawSceneBackground(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: Scene,
  width: number,
  height: number,
) {
  ctx.fillStyle = getSceneBackgroundBaseColor(scene.background);
  ctx.fillRect(0, 0, width, height);

  if (!scene.background) {
    return;
  }

  if (scene.background.type === 'image' && scene.background.value) {
    try {
      const image = await loadImageSource(scene.background.value);
      ctx.drawImage(image, 0, 0, width, height);
    } catch {
      // Keep the solid color fallback.
    }
    return;
  }

  if (scene.background.type !== 'tiled' || !scene.background.chunks) {
    return;
  }

  const canvasWidth = project.settings.canvasWidth;
  const canvasHeight = project.settings.canvasHeight;
  const worldLeft = -canvasWidth / 2;
  const worldRight = canvasWidth / 2;
  const worldBottom = -canvasHeight / 2;
  const worldTop = canvasHeight / 2;
  const worldWidth = Math.max(1, worldRight - worldLeft);
  const worldHeight = Math.max(1, worldTop - worldBottom);
  const chunkEntries = Object.entries(scene.background.chunks);

  await Promise.all(
    chunkEntries.map(async ([chunkKey, source]) => {
      const chunkCoord = parseChunkKey(chunkKey);
      if (!chunkCoord || !source) {
        return;
      }

      const bounds = getChunkWorldBounds(
        chunkCoord.cx,
        chunkCoord.cy,
        scene.background?.chunkSize,
      );

      if (bounds.right <= worldLeft || bounds.left >= worldRight || bounds.top <= worldBottom || bounds.bottom >= worldTop) {
        return;
      }

      try {
        const image = await loadImageSource(source);
        const x = ((bounds.left - worldLeft) / worldWidth) * width;
        const y = ((worldTop - bounds.top) / worldHeight) * height;
        const drawWidth = ((bounds.right - bounds.left) / worldWidth) * width;
        const drawHeight = ((bounds.top - bounds.bottom) / worldHeight) * height;
        ctx.drawImage(image, x, y, drawWidth, drawHeight);
      } catch {
        // Ignore failed background chunks so one corrupt tile does not break the thumbnail.
      }
    }),
  );
}

function drawSceneGround(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: Scene,
  width: number,
  height: number,
) {
  if (!scene.ground?.enabled) {
    return;
  }

  const canvasWidth = project.settings.canvasWidth;
  const canvasHeight = project.settings.canvasHeight;
  const groundTop = userToCanvasPoint(0, scene.ground.y, canvasWidth, canvasHeight).y;
  const drawTop = Math.max(0, Math.min(height, (groundTop / canvasHeight) * height));
  ctx.fillStyle = scene.ground.color || '#7c5c3e';
  ctx.fillRect(0, drawTop, width, height - drawTop);
}

async function drawSceneObjects(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: Scene,
  width: number,
  height: number,
) {
  const orderedObjects = getSceneObjectsInLayerOrder(scene);
  for (const object of orderedObjects) {
    if (!object.visible) {
      continue;
    }

    const effectiveProps = getEffectiveObjectProps(object, project.components);
    const costume = effectiveProps.costumes[effectiveProps.currentCostumeIndex] ?? effectiveProps.costumes[0] ?? null;
    if (!costume?.assetId) {
      continue;
    }

    try {
      const image = await loadImageSource(costume.assetId);
      const sourceBounds = getCostumeBoundsInAssetSpace(costume.bounds ?? null, costume.assetFrame ?? null);
      const sourceX = sourceBounds?.x ?? 0;
      const sourceY = sourceBounds?.y ?? 0;
      const sourceWidth = sourceBounds?.width ?? (image.naturalWidth || image.width);
      const sourceHeight = sourceBounds?.height ?? (image.naturalHeight || image.height);
      const drawWidth = Math.max(1, costume.bounds?.width ?? sourceWidth);
      const drawHeight = Math.max(1, costume.bounds?.height ?? sourceHeight);
      const canvasPoint = userToCanvasPoint(
        object.x,
        object.y,
        project.settings.canvasWidth,
        project.settings.canvasHeight,
      );
      const drawX = (canvasPoint.x / project.settings.canvasWidth) * width;
      const drawY = (canvasPoint.y / project.settings.canvasHeight) * height;
      const scaleX = (width / project.settings.canvasWidth) * object.scaleX;
      const scaleY = (height / project.settings.canvasHeight) * object.scaleY;

      ctx.save();
      ctx.translate(drawX, drawY);
      ctx.rotate((object.rotation * Math.PI) / 180);
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight,
      );
      ctx.restore();
    } catch {
      // Skip missing or corrupt costume sources.
    }
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, THUMBNAIL_TYPE, THUMBNAIL_QUALITY);
  });
}

export async function renderProjectThumbnail(project: Project): Promise<Blob | null> {
  const primaryScene = pickPrimaryScene(project);
  if (!primaryScene) {
    return null;
  }

  const sourceWidth = Math.max(1, Math.round(project.settings.canvasWidth));
  const sourceHeight = Math.max(1, Math.round(project.settings.canvasHeight));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    return null;
  }

  sourceCtx.imageSmoothingEnabled = true;
  sourceCtx.imageSmoothingQuality = 'high';

  await drawSceneBackground(sourceCtx, project, primaryScene, sourceWidth, sourceHeight);
  drawSceneGround(sourceCtx, project, primaryScene, sourceWidth, sourceHeight);
  await drawSceneObjects(sourceCtx, project, primaryScene, sourceWidth, sourceHeight);

  const { width, height } = getThumbnailCanvasSize(project);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = getSceneBackgroundBaseColor(primaryScene.background);
  ctx.fillRect(0, 0, width, height);

  const cameraSnapshot = getThumbnailCameraSnapshot(project, primaryScene);
  const drawScaleX = (width / sourceWidth) * cameraSnapshot.zoom;
  const drawScaleY = (height / sourceHeight) * cameraSnapshot.zoom;
  const drawWidth = sourceWidth * drawScaleX;
  const drawHeight = sourceHeight * drawScaleY;
  const drawX = width / 2 - cameraSnapshot.centerX * drawScaleX;
  const drawY = height / 2 - cameraSnapshot.centerY * drawScaleY;

  ctx.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight);

  return await canvasToBlob(canvas);
}
