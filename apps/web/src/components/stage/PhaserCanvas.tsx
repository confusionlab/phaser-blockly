import { useEffect, useRef, useCallback, useLayoutEffect, useState } from 'react';
import Phaser from 'phaser';
import { flushSync } from 'react-dom';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { RuntimeEngine, setCurrentRuntime, registerCodeGenerators, generateCodeForObject, clearSharedGlobalVariables } from '@/phaser';
import { setBodyGravityY } from '@/phaser/gravity';
import { Button } from '@/components/ui/button';
import type {
  Scene as SceneData,
  GameObject,
  ComponentDefinition,
  Variable,
  BackgroundConfig,
  Costume,
  CostumeAssetFrame,
  CostumeBounds,
} from '@/types';
import { COMPONENT_COLOR, getEffectiveObjectProps } from '@/types';
import { getSceneObjectsInLayerOrder } from '@/utils/layerTree';
import { runInHistoryTransaction } from '@/store/universalHistory';
import {
  getProjectedChunkSizePx,
} from '@/lib/background/chunkMath';
import { loadImageSource } from '@/lib/assets/imageSourceCache';
import {
  normalizeStageEditorViewport,
  panStageEditorViewport,
  scrollStageEditorViewport,
  zoomStageEditorViewportAtScreenPoint,
  type StageEditorViewport,
  type StageSize,
  type StageViewMode,
} from '@/lib/stageViewport';
import {
  createStageViewportController,
  getStageViewportController,
} from '@/lib/phaserStageViewport';
import { focusKeyboardSurface } from '@/utils/keyboard';
import { getDraggedComponentId, setDraggedComponentId } from './shelfDrag';
import {
  getSceneBackgroundBaseColor,
  getTiledBackgroundChunkSize,
  isTiledBackground,
  TiledBackgroundCanvasCompositor,
  type UserSpaceViewport,
} from '@/lib/background/compositor';
import {
  areCostumeAssetFramesEqual,
  getCostumeAssetCenterOffset,
  getCostumeBoundsInAssetSpace,
  getCostumeVisibleCenterOffset,
} from '@/lib/costume/costumeAssetFrame';
import {
  computeEdgeScaleResult,
  TRANSFORM_GIZMO_HANDLE_RADIUS,
  getTransformGizmoCornerHitRadius,
  getTransformGizmoEdgeCornerPreferenceInset,
  computeCornerScaleResult,
  DEFAULT_TRANSFORM_GIZMO_PROPORTIONAL_DIAGONAL,
  getTransformCornerDiagonal,
  getTransformGizmoRotateRingRadii,
  getTransformGizmoCornerCursor,
  getTransformGizmoEdgeCursor,
  getTransformGizmoEdgeSegments,
  getTransformGizmoHandleFrame,
  getOppositeTransformGizmoSide,
  getTransformGizmoRotateCursor,
  getTransformDiagonal,
  isPointInsideTransformRotateRing,
  rotateTransformPoint,
  TRANSFORM_GIZMO_PROPORTIONAL_GUIDE_DASH,
  TRANSFORM_GIZMO_STROKE_WIDTH,
} from '@/lib/editor/unifiedTransformGizmo';
import type { TransformGizmoCorner, TransformGizmoSide } from '@/lib/editor/unifiedTransformGizmo';
import { buildVariableDefinitionIndex } from '@/lib/variableUtils';
import type { InventoryItemEntry } from '@/phaser/RuntimeEngine';

// Register code generators once at module load
registerCodeGenerators();

// Track runtimes for each scene (for pause/resume across scene switches)
const sceneRuntimes: Map<string, RuntimeEngine> = new Map();
const GIZMO_HANDLE_NAMES = [
  'handle_nw',
  'handle_ne',
  'handle_sw',
  'handle_se',
  'handle_n',
  'handle_e',
  'handle_s',
  'handle_w',
  'handle_rotate',
  'handle_rotate_nw',
  'handle_rotate_ne',
  'handle_rotate_sw',
  'handle_rotate_se',
];
const PIXEL_HIT_ALPHA_TOLERANCE = 1;
const GIZMO_STROKE_PX = 2;
const GIZMO_EDGE_HIT_THICKNESS_PX = 16;
const GIZMO_CORNER_HIT_RADIUS_PX = getTransformGizmoCornerHitRadius(TRANSFORM_GIZMO_HANDLE_RADIUS);
const GIZMO_EDGE_CORNER_PREFERENCE_INSET_PX = getTransformGizmoEdgeCornerPreferenceInset(TRANSFORM_GIZMO_HANDLE_RADIUS);
const GIZMO_ROTATE_RING_RADIUS_PX = getTransformGizmoRotateRingRadii(TRANSFORM_GIZMO_HANDLE_RADIUS).outerRadius;
const BACKGROUND_MIN_PROJECTED_CHUNK_SIZE = 0.35;
const GROUND_LAYER_DEPTH = -1000;
const TILED_BACKGROUND_LAYER_DEPTH = -950;
const INVENTORY_PAGE_SIZE = 8;
const COSTUME_CANVAS_SIZE = 1024;
const INVENTORY_PREVIEW_SIZE = 40;
const EDITOR_RESIZE_FREEZE_EVENT = 'pocha-editor-resize-freeze';
const STAGE_GIZMO_COLOR = 0x0ea5e9;
const STAGE_GIZMO_COLOR_CSS = 'rgb(14, 165, 233)';
const STAGE_GIZMO_FILL_CSS = 'rgba(14, 165, 233, 0.08)';
const STAGE_SELECTION_FILL_ALPHA = 0.06;

type StageGizmoPalette = {
  phaserColor: number;
  strokeCss: string;
  fillCss: string;
  handleStrokeCss: string;
};

type FrozenStageFrame = {
  src: string;
  width: number;
  height: number;
};

type PendingCostumeVisualTarget = {
  costumeId: string | null;
  assetId: string | null;
  assetFrame?: CostumeAssetFrame | null;
  textureKey: string | null;
};

type ComponentDragPreview = {
  componentId: string;
  localX: number;
  localY: number;
  bounds: CostumeBounds | null;
  assetId: string | null;
  assetFrame: CostumeAssetFrame | null;
  zoom: number;
};

type CostumeVisualMetrics = {
  imageWidth: number;
  imageHeight: number;
  assetOffset: { x: number; y: number };
  localBounds: CostumeBounds | null;
  interactionWidth: number;
  interactionHeight: number;
  interactionOffset: { x: number; y: number };
};

type SelectionFrame = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation?: number;
};

type SelectionGuide = {
  proportional: boolean;
  corner: TransformGizmoCorner | null;
};

type StageDebugSnapshot = {
  mode: StageViewMode;
  editorViewport: StageEditorViewport | null;
  hostSize: StageSize;
  cameraViewportCenter: { x: number; y: number } | null;
  cameraState: {
    scrollX: number;
    scrollY: number;
    zoomX: number;
    zoomY: number;
    viewportX: number;
    viewportY: number;
    width: number;
    height: number;
  } | null;
};

type StageDebugApi = {
  getEditorSceneSnapshot: () => StageDebugSnapshot | null;
  setEditorViewport: (viewport: StageEditorViewport) => void;
  setViewMode: (mode: StageViewMode) => void;
  getWorldPointAtClientPosition: (clientX: number, clientY: number) => { x: number; y: number } | null;
};

function getCostumeVisualMetrics({
  bounds,
  assetFrame,
  imageWidth,
  imageHeight,
}: {
  bounds: CostumeBounds | null | undefined;
  assetFrame?: CostumeAssetFrame | null;
  imageWidth: number;
  imageHeight: number;
}): CostumeVisualMetrics {
  const resolvedImageWidth = Math.max(1, Math.round(imageWidth || assetFrame?.width || COSTUME_CANVAS_SIZE));
  const resolvedImageHeight = Math.max(1, Math.round(imageHeight || assetFrame?.height || COSTUME_CANVAS_SIZE));
  const assetOffset = getCostumeAssetCenterOffset(assetFrame);
  const localBounds = getCostumeBoundsInAssetSpace(bounds, assetFrame);

  if (bounds && bounds.width > 0 && bounds.height > 0) {
    return {
      imageWidth: resolvedImageWidth,
      imageHeight: resolvedImageHeight,
      assetOffset,
      localBounds,
      interactionWidth: Math.max(bounds.width, 32),
      interactionHeight: Math.max(bounds.height, 32),
      interactionOffset: getCostumeVisibleCenterOffset(bounds, {
        assetFrame,
        assetWidth: resolvedImageWidth,
        assetHeight: resolvedImageHeight,
      }),
    };
  }

  return {
    imageWidth: resolvedImageWidth,
    imageHeight: resolvedImageHeight,
    assetOffset,
    localBounds,
    interactionWidth: Math.max(resolvedImageWidth, 32),
    interactionHeight: Math.max(resolvedImageHeight, 32),
    interactionOffset: assetOffset,
  };
}

function areCostumeBoundsEqual(
  a: CostumeBounds | null | undefined,
  b: CostumeBounds | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

let cssColorParsingContext: CanvasRenderingContext2D | null | undefined;

function getCssColorParsingContext(): CanvasRenderingContext2D | null {
  if (cssColorParsingContext !== undefined) {
    return cssColorParsingContext;
  }

  if (typeof document === 'undefined') {
    cssColorParsingContext = null;
    return cssColorParsingContext;
  }

  cssColorParsingContext = document.createElement('canvas').getContext('2d');
  return cssColorParsingContext;
}

function parseResolvedCssColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    const expandedHex = hex.length === 3
      ? hex.split('').map((char) => `${char}${char}`).join('')
      : hex.length === 6
        ? hex
        : null;
    if (!expandedHex) {
      return null;
    }
    const value = Number.parseInt(expandedHex, 16);
    if (!Number.isFinite(value)) {
      return null;
    }
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff,
    };
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgbMatch) {
    return null;
  }

  const channels = rgbMatch[1]
    .split(',')
    .map((segment) => Number.parseFloat(segment.trim()))
    .filter((channel) => Number.isFinite(channel));
  if (channels.length < 3) {
    return null;
  }

  return {
    r: Math.max(0, Math.min(255, Math.round(channels[0]!))),
    g: Math.max(0, Math.min(255, Math.round(channels[1]!))),
    b: Math.max(0, Math.min(255, Math.round(channels[2]!))),
  };
}

function resolveCssColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const context = getCssColorParsingContext();
  if (context) {
    context.fillStyle = '#000000';
    context.fillStyle = color;
    const parsed = parseResolvedCssColorToRgb(context.fillStyle);
    if (parsed) {
      return parsed;
    }
  }

  return parseResolvedCssColorToRgb(color);
}

function getResolvedComponentStageColor(): string {
  if (typeof document === 'undefined') {
    return COMPONENT_COLOR;
  }

  const color = window.getComputedStyle(document.documentElement).getPropertyValue('--component-color').trim();
  return color || COMPONENT_COLOR;
}

function createStageGizmoPaletteFromCssColor(cssColor: string, fallbackPhaserColor: number): StageGizmoPalette {
  const rgb = resolveCssColorToRgb(cssColor);
  if (!rgb) {
    return {
      phaserColor: fallbackPhaserColor,
      strokeCss: cssColor,
      fillCss: STAGE_GIZMO_FILL_CSS,
      handleStrokeCss: cssColor,
    };
  }

  return {
    phaserColor: (rgb.r << 16) | (rgb.g << 8) | rgb.b,
    strokeCss: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    fillCss: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`,
    handleStrokeCss: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
  };
}

function getStageGizmoPaletteForObject(object: GameObject | null | undefined): StageGizmoPalette {
  if (!object?.componentId) {
    return {
      phaserColor: STAGE_GIZMO_COLOR,
      strokeCss: STAGE_GIZMO_COLOR_CSS,
      fillCss: STAGE_GIZMO_FILL_CSS,
      handleStrokeCss: STAGE_GIZMO_COLOR_CSS,
    };
  }

  return createStageGizmoPaletteFromCssColor(getResolvedComponentStageColor(), STAGE_GIZMO_COLOR);
}

function getStageGizmoPaletteForSelection(scene: Phaser.Scene, selectedIds: string[]): StageGizmoPalette {
  if (
    selectedIds.length > 0
    && selectedIds.every((selectedId) => {
      const container = scene.children.getByName(selectedId) as Phaser.GameObjects.Container | null;
      const objectData = container?.getData('objectData') as GameObject | undefined;
      return !!objectData?.componentId;
    })
  ) {
    return createStageGizmoPaletteFromCssColor(getResolvedComponentStageColor(), STAGE_GIZMO_COLOR);
  }

  return {
    phaserColor: STAGE_GIZMO_COLOR,
    strokeCss: STAGE_GIZMO_COLOR_CSS,
    fillCss: STAGE_GIZMO_FILL_CSS,
    handleStrokeCss: STAGE_GIZMO_COLOR_CSS,
  };
}

function getStageShellBackgroundColor(
  mode: StageViewMode,
  background: BackgroundConfig | null | undefined,
): string {
  return mode === 'editor' ? getSceneBackgroundBaseColor(background) : '#000000';
}

function drawDashedWorldLine(
  graphics: Phaser.GameObjects.Graphics,
  start: { x: number; y: number },
  end: { x: number; y: number },
  dashLength: number,
  gapLength: number,
): void {
  const totalLength = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
  if (totalLength <= 0) {
    return;
  }

  const safeDashLength = Math.max(0.0001, dashLength);
  const safeGapLength = Math.max(0, gapLength);
  let distance = 0;

  while (distance < totalLength) {
    const dashStart = distance;
    const dashEnd = Math.min(totalLength, dashStart + safeDashLength);
    const startT = dashStart / totalLength;
    const endT = dashEnd / totalLength;
    graphics.beginPath();
    graphics.moveTo(
      Phaser.Math.Linear(start.x, end.x, startT),
      Phaser.Math.Linear(start.y, end.y, startT),
    );
    graphics.lineTo(
      Phaser.Math.Linear(start.x, end.x, endT),
      Phaser.Math.Linear(start.y, end.y, endT),
    );
    graphics.strokePath();
    distance += safeDashLength + safeGapLength;
  }
}

// Coordinate transformation utilities
// User space: (0,0) at center, +Y is up
// Phaser space: (0,0) at top-left, +Y is down

function userToPhaser(userX: number, userY: number, canvasWidth: number, canvasHeight: number) {
  return {
    x: userX + canvasWidth / 2,
    y: canvasHeight / 2 - userY
  };
}

function phaserToUser(phaserX: number, phaserY: number, canvasWidth: number, canvasHeight: number) {
  return {
    x: phaserX - canvasWidth / 2,
    y: canvasHeight / 2 - phaserY
  };
}

function hashTextureInput(value: string): string {
  // FNV-1a hash keeps runtime cost low while producing deterministic texture keys.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function getCostumeTextureKey(objectId: string, costumeId: string, assetId: string): string {
  return `costume_${objectId}_${costumeId}_${hashTextureInput(assetId)}`;
}

function getElementRenderSize(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width || element.clientWidth || 1)),
    height: Math.max(1, Math.round(rect.height || element.clientHeight || 1)),
  };
}

function getElementLocalPoint(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  const renderSize = getElementRenderSize(element);
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);

  return {
    x: ((clientX - rect.left) / width) * renderSize.width,
    y: ((clientY - rect.top) / height) * renderSize.height,
  };
}

function getPendingCostumeVisualTarget(
  container: Phaser.GameObjects.Container,
): PendingCostumeVisualTarget | undefined {
  return container.getData('pendingVisualTarget') as PendingCostumeVisualTarget | undefined;
}

function drawWorldBoundary(
  graphics: Phaser.GameObjects.Graphics,
  sceneData: SceneData | undefined,
  canvasWidth: number,
  canvasHeight: number,
): void {
  graphics.clear();

  if (!sceneData?.worldBoundary?.enabled || !sceneData.worldBoundary.points || sceneData.worldBoundary.points.length < 2) {
    return;
  }

  const points = sceneData.worldBoundary.points;
  const first = userToPhaser(points[0].x, points[0].y, canvasWidth, canvasHeight);
  graphics.lineStyle(3, 0x60a5fa, 0.8);
  graphics.beginPath();
  graphics.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = userToPhaser(points[index].x, points[index].y, canvasWidth, canvasHeight);
    graphics.lineTo(point.x, point.y);
  }
  graphics.closePath();
  graphics.strokePath();
}

interface TiledBackgroundRenderSnapshot {
  viewportWidth: number;
  viewportHeight: number;
  worldLeft: number;
  worldTop: number;
  worldWidth: number;
  worldHeight: number;
  zoom: number;
}

interface TiledBackgroundLayerState {
  textureKey: string;
  canvas: HTMLCanvasElement;
  texture: Phaser.Textures.CanvasTexture;
  image: Phaser.GameObjects.Image;
  compositor: TiledBackgroundCanvasCompositor;
  background: BackgroundConfig | null;
  canvasWidth: number;
  canvasHeight: number;
  needsRedraw: boolean;
  renderScale: number;
  lastBackgroundRef: BackgroundConfig | null;
  lastRenderSnapshot: TiledBackgroundRenderSnapshot | null;
}

function createTiledBackgroundLayerState(
  scene: Phaser.Scene,
  background: BackgroundConfig | null | undefined,
  canvasWidth: number,
  canvasHeight: number,
): TiledBackgroundLayerState {
  const textureKey = `tiled_background_${scene.sys.settings.key}_${Math.random().toString(36).slice(2)}`;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const texture = scene.textures.addCanvas(textureKey, canvas);
  if (!texture) {
    throw new Error('Failed to create tiled background canvas texture.');
  }
  const image = scene.add.image(0, 0, textureKey);
  image.setOrigin(0, 0);
  image.setDepth(TILED_BACKGROUND_LAYER_DEPTH);
  const layer = {} as TiledBackgroundLayerState;
  const compositor = new TiledBackgroundCanvasCompositor({
    onChange: () => {
      layer.needsRedraw = true;
    },
  });
  Object.assign(layer, {
    textureKey,
    canvas,
    texture,
    image,
    compositor,
    background: background ?? null,
    canvasWidth,
    canvasHeight,
    needsRedraw: true,
    renderScale: 1,
    lastBackgroundRef: null,
    lastRenderSnapshot: null,
  });
  return layer;
}

function destroyTiledBackgroundLayer(scene: Phaser.Scene, layer: TiledBackgroundLayerState): void {
  layer.compositor.dispose();
  layer.image.destroy();
  if (scene.textures.exists(layer.textureKey)) {
    scene.textures.remove(layer.textureKey);
  }
}

function hasTiledBackgroundSnapshotChanged(
  previous: TiledBackgroundRenderSnapshot | null,
  next: TiledBackgroundRenderSnapshot,
): boolean {
  if (!previous) return true;
  const epsilon = 1e-3;
  return (
    previous.viewportWidth !== next.viewportWidth ||
    previous.viewportHeight !== next.viewportHeight ||
    Math.abs(previous.worldLeft - next.worldLeft) > epsilon ||
    Math.abs(previous.worldTop - next.worldTop) > epsilon ||
    Math.abs(previous.worldWidth - next.worldWidth) > epsilon ||
    Math.abs(previous.worldHeight - next.worldHeight) > epsilon ||
    Math.abs(previous.zoom - next.zoom) > epsilon
  );
}

function getUserViewportFromPhaserWorldView(
  worldView: Phaser.Geom.Rectangle,
  canvasWidth: number,
  canvasHeight: number,
): UserSpaceViewport {
  const cornerTopLeft = phaserToUser(worldView.left, worldView.top, canvasWidth, canvasHeight);
  const cornerTopRight = phaserToUser(worldView.right, worldView.top, canvasWidth, canvasHeight);
  const cornerBottomLeft = phaserToUser(worldView.left, worldView.bottom, canvasWidth, canvasHeight);
  const cornerBottomRight = phaserToUser(worldView.right, worldView.bottom, canvasWidth, canvasHeight);

  return {
    left: Math.min(cornerTopLeft.x, cornerTopRight.x, cornerBottomLeft.x, cornerBottomRight.x),
    right: Math.max(cornerTopLeft.x, cornerTopRight.x, cornerBottomLeft.x, cornerBottomRight.x),
    bottom: Math.min(cornerTopLeft.y, cornerTopRight.y, cornerBottomLeft.y, cornerBottomRight.y),
    top: Math.max(cornerTopLeft.y, cornerTopRight.y, cornerBottomLeft.y, cornerBottomRight.y),
  };
}

function updateTiledBackgroundLayer(scene: Phaser.Scene, layer: TiledBackgroundLayerState): void {
  const background = layer.background;
  if (layer.lastBackgroundRef !== background) {
    layer.lastBackgroundRef = background;
    layer.needsRedraw = true;
  }

  if (!isTiledBackground(background)) {
    layer.image.setVisible(false);
    layer.lastRenderSnapshot = null;
    return;
  }

  const chunkSize = getTiledBackgroundChunkSize(background);
  const camera = scene.cameras.main;
  const projectedChunkSize = getProjectedChunkSizePx(chunkSize, camera.zoom);

  if (projectedChunkSize < BACKGROUND_MIN_PROJECTED_CHUNK_SIZE) {
    layer.image.setVisible(false);
    layer.lastRenderSnapshot = null;
    return;
  }

  camera.preRender();
  const worldView = camera.worldView;
  const viewportWidth = Math.max(1, Math.round(camera.width));
  const viewportHeight = Math.max(1, Math.round(camera.height));
  const nextSnapshot: TiledBackgroundRenderSnapshot = {
    viewportWidth,
    viewportHeight,
    worldLeft: worldView.left,
    worldTop: worldView.top,
    worldWidth: worldView.width,
    worldHeight: worldView.height,
    zoom: camera.zoom,
  };

  if (layer.needsRedraw || hasTiledBackgroundSnapshotChanged(layer.lastRenderSnapshot, nextSnapshot)) {
    const viewport = getUserViewportFromPhaserWorldView(worldView, layer.canvasWidth, layer.canvasHeight);
    const { pending } = layer.compositor.render({
      canvas: layer.canvas,
      background,
      viewport,
      pixelWidth: viewportWidth * layer.renderScale,
      pixelHeight: viewportHeight * layer.renderScale,
    });
    layer.texture.setSize(layer.canvas.width, layer.canvas.height);
    layer.texture.refresh();
    layer.needsRedraw = pending;
    layer.lastRenderSnapshot = nextSnapshot;
  }

  layer.image.setPosition(worldView.left, worldView.top);
  layer.image.setDisplaySize(worldView.width, worldView.height);
  layer.image.setVisible(true);
}

function refreshTiledBackgroundLayer(scene: Phaser.Scene): void {
  const tiledBackgroundLayer = scene.data.get('tiledBackgroundLayer') as TiledBackgroundLayerState | undefined;
  if (!tiledBackgroundLayer) return;
  tiledBackgroundLayer.needsRedraw = true;
  updateTiledBackgroundLayer(scene, tiledBackgroundLayer);
}

function destroyEditorContainer(scene: Phaser.Scene, container: Phaser.GameObjects.Container): void {
  const textureKey = container.getData('textureKey') as string | undefined;
  if (textureKey && textureKey.startsWith('costume_') && scene.textures.exists(textureKey)) {
    scene.textures.remove(textureKey);
  }
  container.destroy();
}

function isPointOnOpaqueSpritePixel(scene: Phaser.Scene, sprite: Phaser.GameObjects.Image, worldX: number, worldY: number): boolean {
  if (!sprite.visible || !sprite.active || sprite.alpha <= 0) return false;
  if (!sprite.texture || !sprite.frame) return false;

  const local = sprite.getWorldTransformMatrix().applyInverse(worldX, worldY, new Phaser.Math.Vector2());
  const localX = local.x + sprite.displayOriginX;
  const localY = local.y + sprite.displayOriginY;
  const spriteWidth = sprite.width;
  const spriteHeight = sprite.height;

  if (spriteWidth <= 0 || spriteHeight <= 0) return false;
  if (localX < 0 || localY < 0 || localX >= spriteWidth || localY >= spriteHeight) return false;

  // `getPixelAlpha` expects frame-space pixel indices. Clamp and floor to avoid null on subpixels.
  const pixelX = Math.floor(Math.max(0, Math.min(spriteWidth - 1, localX)));
  const pixelY = Math.floor(Math.max(0, Math.min(spriteHeight - 1, localY)));
  const alpha = scene.textures.getPixelAlpha(pixelX, pixelY, sprite.texture.key, sprite.frame.name);

  if (alpha === null || alpha === undefined) {
    // Treat unknown alpha as miss to avoid broad non-pixel-perfect selections.
    return false;
  }
  return alpha >= PIXEL_HIT_ALPHA_TOLERANCE;
}

function pickTopObjectIdAtWorldPoint(scene: Phaser.Scene, worldX: number, worldY: number): string | null {
  const containers: Phaser.GameObjects.Container[] = [];
  scene.children.each((child: Phaser.GameObjects.GameObject) => {
    if (child instanceof Phaser.GameObjects.Container && child.getData('objectData')) {
      containers.push(child);
    }
  });

  const displayList = scene.children;
  containers.sort((a, b) => {
    if (a.depth !== b.depth) return b.depth - a.depth;
    return displayList.getIndex(b) - displayList.getIndex(a);
  });

  for (const container of containers) {
    if (!container.visible || !container.active || container.alpha <= 0) continue;

    const sprite = container.getByName('sprite') as Phaser.GameObjects.Image | null;
    if (sprite) {
      if (isPointOnOpaqueSpritePixel(scene, sprite, worldX, worldY)) {
        return container.name;
      }
      continue;
    }

    // Placeholder objects without a sprite: fallback to geometric hit.
    const hitRect = container.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
    const bounds = hitRect ? hitRect.getBounds() : container.getBounds();
    if (bounds.contains(worldX, worldY)) {
      return container.name;
    }
  }

  return null;
}

function getOrderedObjectIdsForActiveScene(fallbackIds: string[] = []): string[] {
  const { project } = useProjectStore.getState();
  const { selectedSceneId } = useEditorStore.getState();
  if (!project || !selectedSceneId) return fallbackIds;

  const activeScene = project.scenes.find((sceneState) => sceneState.id === selectedSceneId);
  return activeScene ? getSceneObjectsInLayerOrder(activeScene).map((obj) => obj.id) : fallbackIds;
}

function resolveSceneByReference(scenes: SceneData[], sceneRef: string): SceneData | undefined {
  const normalizedRef = sceneRef.trim();
  if (!normalizedRef) return undefined;

  const byId = scenes.find((scene) => scene.id === normalizedRef);
  if (byId) return byId;

  const byName = scenes.filter((scene) => scene.name === normalizedRef);
  return byName.length === 1 ? byName[0] : undefined;
}

function InventoryCostumePreview({
  assetId,
  assetFrame,
  bounds,
  label,
  size = INVENTORY_PREVIEW_SIZE,
}: {
  assetId: string;
  assetFrame?: CostumeAssetFrame | null;
  bounds: CostumeBounds | null;
  label: string;
  size?: number;
}) {
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const scale = Math.min(1, size / Math.max(bounds.width, bounds.height));
    const localBounds = getCostumeBoundsInAssetSpace(bounds, assetFrame);
    return (
      <div
        role="img"
        aria-label={label}
        className="relative pointer-events-none"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute"
          style={{
            backgroundImage: `url(${assetId})`,
            backgroundPosition: localBounds ? `${-localBounds.x}px ${-localBounds.y}px` : '0 0',
            backgroundSize: assetFrame
              ? `${assetFrame.width}px ${assetFrame.height}px`
              : `${COSTUME_CANVAS_SIZE}px ${COSTUME_CANVAS_SIZE}px`,
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
            width: bounds.width,
            height: bounds.height,
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        />
      </div>
    );
  }

  return (
    <img
      src={assetId}
      alt={label}
      className="max-h-10 max-w-10 object-contain pointer-events-none"
    />
  );
}

function isClientPointInsideInventoryUI(clientX: number, clientY: number): boolean {
  return document
    .elementsFromPoint(clientX, clientY)
    .some((element) => element instanceof HTMLElement && !!element.closest('[data-pocha-ui="inventory"]'));
}

interface PhaserCanvasProps {
  isPlaying: boolean;
  deferEditorResize?: boolean;
  layoutMode?: 'panel' | 'fullscreen';
}

export function PhaserCanvas({ isPlaying, deferEditorResize = false, layoutMode = 'panel' }: PhaserCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const runtimeRef = useRef<RuntimeEngine | null>(null);
  const inventoryUnsubscribeRef = useRef<(() => void) | null>(null);
  const inventoryVisibilityUnsubscribeRef = useRef<(() => void) | null>(null);
  const draggedInventoryItemRef = useRef<{
    entry: InventoryItemEntry;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const creationIdRef = useRef(0); // Track which creation attempt is current
  // Track the initial scene when play mode starts - don't recreate game when scene changes during play
  const playModeInitialSceneRef = useRef<string | null>(null);
  const editorViewportBySceneIdRef = useRef<Map<string, StageEditorViewport>>(new Map());
  const [activeRuntime, setActiveRuntime] = useState<RuntimeEngine | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemEntry[]>([]);
  const [isInventoryVisible, setIsInventoryVisible] = useState(true);
  const [inventoryPage, setInventoryPage] = useState(0);
  const [draggedInventoryItem, setDraggedInventoryItem] = useState<{
    entry: InventoryItemEntry;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [draggedInventoryCanDrop, setDraggedInventoryCanDrop] = useState(false);
  const [frozenStageFrame, setFrozenStageFrame] = useState<FrozenStageFrame | null>(null);
  const [componentDragPreview, setComponentDragPreview] = useState<ComponentDragPreview | null>(null);
  const immediateResizeFreezeRef = useRef(false);
  const [manualResizeFreezeActive, setManualResizeFreezeActive] = useState(false);

  const { project, updateObject, addComponentInstance } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedObjectIds, selectObjects, selectScene, showColliderOutlines, viewMode } = useEditorStore();

  // Use refs for values accessed in Phaser callbacks to avoid stale closures
  const selectedSceneIdRef = useRef(selectedSceneId);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const selectedObjectIdsRef = useRef(selectedObjectIds);
  const canvasDimensionsRef = useRef({ width: 800, height: 600 });

  // Keep refs in sync
  selectedSceneIdRef.current = selectedSceneId;
  selectedObjectIdRef.current = selectedObjectId;
  selectedObjectIdsRef.current = selectedObjectIds;
  if (project) {
    canvasDimensionsRef.current = { width: project.settings.canvasWidth, height: project.settings.canvasHeight };
  }

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const isResizeFrozen = deferEditorResize || manualResizeFreezeActive;

  const syncEditorCanvasToHost = useCallback((force = false) => {
    if (isPlaying || isResizeFrozen || immediateResizeFreezeRef.current) {
      return;
    }

    const host = containerRef.current;
    const game = gameRef.current;
    if (!host || !game) {
      return;
    }

    const { width: nextWidth, height: nextHeight } = getElementRenderSize(host);
    const canvasWidth = game.canvas?.width ?? 0;
    const canvasHeight = game.canvas?.height ?? 0;
    const scaleMatches = game.scale.width === nextWidth && game.scale.height === nextHeight;
    const canvasMatches = canvasWidth === nextWidth && canvasHeight === nextHeight;

    if (!force && scaleMatches && canvasMatches) {
      return;
    }

    game.scale.resize(nextWidth, nextHeight);
    game.scale.refresh();

    const phaserScene = game.scene.getScene('EditorScene') as Phaser.Scene | undefined;
    if (phaserScene) {
      getStageViewportController(phaserScene)?.syncProjection();
      refreshTiledBackgroundLayer(phaserScene);
    }
  }, [isPlaying, isResizeFrozen]);

  useEffect(() => {
    editorViewportBySceneIdRef.current.clear();
  }, [project?.id]);

  const captureFrozenStageFrame = useCallback((): FrozenStageFrame | null => {
    const canvas = gameRef.current?.canvas;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      return null;
    }

    const src = canvas.toDataURL('image/png');
    const canvasRect = canvas.getBoundingClientRect();

    return {
      src,
      width: canvasRect.width,
      height: canvasRect.height,
    };
  }, []);

  const getStoredEditorViewport = useCallback((
    sceneId: string | null | undefined,
    canvasSize: StageSize,
  ): StageEditorViewport => {
    const key = sceneId ?? '__default__';
    const stored = editorViewportBySceneIdRef.current.get(key);
    return normalizeStageEditorViewport(stored, canvasSize);
  }, []);

  const storeEditorViewport = useCallback((
    sceneId: string | null | undefined,
    viewport: StageEditorViewport,
  ) => {
    const key = sceneId ?? '__default__';
    editorViewportBySceneIdRef.current.set(key, viewport);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined' || isPlaying) {
      return;
    }

    const debugApi: StageDebugApi = {
      getEditorSceneSnapshot: () => {
        const editorScene = gameRef.current?.scene.getScene('EditorScene') as Phaser.Scene | undefined;
        const host = containerRef.current;
        if (!editorScene || !host) {
          return null;
        }

        const controller = getStageViewportController(editorScene);
        const camera = editorScene.cameras.main;
        const hostSize = getElementRenderSize(host);
        const cameraViewportCenter = {
          x: camera.scrollX + camera.width / 2,
          y: camera.scrollY + camera.height / 2,
        };

        return {
          mode: controller?.getMode() ?? 'editor',
          editorViewport: controller?.getEditorViewport() ?? null,
          hostSize,
          cameraViewportCenter,
          cameraState: {
            scrollX: camera.scrollX,
            scrollY: camera.scrollY,
            zoomX: camera.zoomX,
            zoomY: camera.zoomY,
            viewportX: camera.x,
            viewportY: camera.y,
            width: camera.width,
            height: camera.height,
          },
        };
      },
      setEditorViewport: (viewport) => {
        const editorScene = gameRef.current?.scene.getScene('EditorScene') as Phaser.Scene | undefined;
        const controller = editorScene ? getStageViewportController(editorScene) : null;
        if (!controller) {
          return;
        }
        controller.setMode('editor');
        controller.setEditorViewport(viewport);
      },
      setViewMode: (mode) => {
        const editorScene = gameRef.current?.scene.getScene('EditorScene') as Phaser.Scene | undefined;
        const controller = editorScene ? getStageViewportController(editorScene) : null;
        controller?.setMode(mode);
      },
      getWorldPointAtClientPosition: (clientX, clientY) => {
        const editorScene = gameRef.current?.scene.getScene('EditorScene') as Phaser.Scene | undefined;
        const host = containerRef.current;
        const controller = editorScene ? getStageViewportController(editorScene) : null;
        if (!editorScene || !controller || !host) {
          return null;
        }
        const inputSurface = gameRef.current?.canvas ?? host;
        const { x, y } = getElementLocalPoint(inputSurface, clientX, clientY);
        const worldPoint = editorScene.cameras.main.getWorldPoint(x, y);
        return worldPoint ? { x: worldPoint.x, y: worldPoint.y } : null;
      },
    };

    const stageWindow = window as typeof window & { __pochaStageDebug?: StageDebugApi };
    stageWindow.__pochaStageDebug = debugApi;
    return () => {
      if (stageWindow.__pochaStageDebug === debugApi) {
        delete stageWindow.__pochaStageDebug;
      }
    };
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying || !containerRef.current) {
      return;
    }

    const host = containerRef.current;

    const getEditorViewportController = () => {
      const game = gameRef.current;
      if (!game) {
        return null;
      }

      const editorScene = game.scene.getScene('EditorScene') as Phaser.Scene | undefined;
      if (!editorScene) {
        return null;
      }

      return getStageViewportController(editorScene);
    };

    const getInputSurface = (): HTMLElement => {
      const canvas = gameRef.current?.canvas;
      if (canvas) {
        return canvas;
      }
      return host;
    };

    const handleHostContextMenu = (event: MouseEvent) => {
      const controller = getEditorViewportController();
      if (controller?.getMode() === 'editor') {
        event.preventDefault();
      }
    };

    const handleHostWheel = (event: WheelEvent) => {
      if (isResizeFrozen || immediateResizeFreezeRef.current) {
        return;
      }

      const controller = getEditorViewportController();
      if (!controller || controller.getMode() !== 'editor') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.ctrlKey || event.metaKey) {
        const editorViewport = controller.getEditorViewport();
        const screenPoint = getElementLocalPoint(getInputSurface(), event.clientX, event.clientY);
        const hostSize = controller.getProjection().hostSize;
        const zoomDelta = -event.deltaY * 0.01;
        const zoomFactor = 1 + zoomDelta;
        const newZoom = Phaser.Math.Clamp(
          editorViewport.zoom * zoomFactor,
          0.1,
          10,
        );

        controller.setEditorViewport(
          zoomStageEditorViewportAtScreenPoint(
            editorViewport,
            hostSize,
            screenPoint,
            newZoom,
          ),
        );
        return;
      }

      controller.setEditorViewport(
        scrollStageEditorViewport(
          controller.getEditorViewport(),
          event.deltaX,
          event.deltaY,
        ),
      );
    };

    host.addEventListener('contextmenu', handleHostContextMenu);
    host.addEventListener('wheel', handleHostWheel, {
      passive: false,
      capture: true,
    });

    return () => {
      host.removeEventListener('contextmenu', handleHostContextMenu);
      host.removeEventListener('wheel', handleHostWheel, true);
    };
  }, [isPlaying, isResizeFrozen]);

  useEffect(() => {
    inventoryUnsubscribeRef.current?.();
    inventoryUnsubscribeRef.current = null;
    inventoryVisibilityUnsubscribeRef.current?.();
    inventoryVisibilityUnsubscribeRef.current = null;

    if (!activeRuntime || !isPlaying) {
      setInventoryItems([]);
      setIsInventoryVisible(true);
      setInventoryPage(0);
      return;
    }

    inventoryUnsubscribeRef.current = activeRuntime.subscribeToInventory((items) => {
      setInventoryItems(items);
    });
    inventoryVisibilityUnsubscribeRef.current = activeRuntime.subscribeToInventoryVisibility((visible) => {
      setIsInventoryVisible(visible);
    });

    return () => {
      inventoryUnsubscribeRef.current?.();
      inventoryUnsubscribeRef.current = null;
      inventoryVisibilityUnsubscribeRef.current?.();
      inventoryVisibilityUnsubscribeRef.current = null;
    };
  }, [activeRuntime, isPlaying]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(inventoryItems.length / INVENTORY_PAGE_SIZE) - 1);
    setInventoryPage((current) => Math.min(current, maxPage));
  }, [inventoryItems.length]);

  useEffect(() => {
    draggedInventoryItemRef.current = draggedInventoryItem;
  }, [draggedInventoryItem]);

  useEffect(() => {
    if (!draggedInventoryItem) {
      setDraggedInventoryCanDrop(false);
      return;
    }

    console.log('[InventoryDrop][UI] Drag started', {
      entryId: draggedInventoryItem.entry.entryId,
      label: draggedInventoryItem.entry.label,
      sourceObjectId: draggedInventoryItem.entry.sourceObjectId,
      sourceComponentId: draggedInventoryItem.entry.sourceComponentId,
    });

    const handlePointerMove = (event: PointerEvent) => {
      const currentRuntime = runtimeRef.current;
      const isOverInventoryUI = isClientPointInsideInventoryUI(event.clientX, event.clientY);
      const canDrop = !isOverInventoryUI && currentRuntime
        ? currentRuntime.canDropInventoryItemAtClientPosition(
            draggedInventoryItem.entry.entryId,
            event.clientX,
            event.clientY,
          )
        : false;
      setDraggedInventoryCanDrop((current) => (current === canDrop ? current : canDrop));
      setDraggedInventoryItem((current) => (
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
            }
          : null
      ));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const currentDrag = draggedInventoryItemRef.current;
      if (!currentDrag) {
        console.warn('[InventoryDrop][UI] Pointer up fired without an active drag item');
        return;
      }
      const currentRuntime = runtimeRef.current;
      const entryId = currentDrag.entry.entryId;
      console.log('[InventoryDrop][UI] Drag released', {
        entryId,
        label: currentDrag.entry.label,
        clientX: event.clientX,
        clientY: event.clientY,
        hasRuntime: !!currentRuntime,
      });
      setDraggedInventoryCanDrop(false);
      setDraggedInventoryItem(null);
      if (isClientPointInsideInventoryUI(event.clientX, event.clientY)) {
        console.log('[InventoryDrop][UI] Drop released over inventory UI, ignoring', {
          entryId,
          label: currentDrag.entry.label,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        return;
      }
      if (currentRuntime) {
        void currentRuntime.handleInventoryDropAtClientPosition(entryId, event.clientX, event.clientY);
      } else {
        console.warn('[InventoryDrop][UI] No active runtime available for inventory drop');
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      setDraggedInventoryCanDrop(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggedInventoryItem?.entry.entryId]);

  // Callback to update object position/scale/rotation after drag - convert from Phaser to user coordinates
  const handleObjectDragEnd = useCallback((objId: string, phaserX: number, phaserY: number, scaleX?: number, scaleY?: number, rotation?: number) => {
    const sceneId = selectedSceneIdRef.current;
    if (sceneId) {
      const { width, height } = canvasDimensionsRef.current;
      const userCoords = phaserToUser(phaserX, phaserY, width, height);
      const updates: Partial<GameObject> = { x: userCoords.x, y: userCoords.y };
      if (scaleX !== undefined) updates.scaleX = scaleX;
      if (scaleY !== undefined) updates.scaleY = scaleY;
      if (rotation !== undefined) updates.rotation = rotation;
      updateObject(sceneId, objId, updates);
    }
  }, [updateObject]);

  const handleStageObjectPointerDown = useCallback((pointer: Phaser.Input.Pointer, objectId: string) => {
    if (!pointer.leftButtonDown()) return;

    const state = useEditorStore.getState();
    const event = pointer.event as MouseEvent | PointerEvent | undefined;
    const isToggleSelection = !!event && (event.metaKey || event.ctrlKey);
    const isAddSelection = !!event && event.shiftKey;
    const currentSelection = state.selectedObjectIds.length > 0
      ? state.selectedObjectIds
      : (state.selectedObjectId ? [state.selectedObjectId] : []);

    if (isToggleSelection) {
      const alreadySelected = currentSelection.includes(objectId);
      const nextIds = alreadySelected
        ? currentSelection.filter(id => id !== objectId)
        : [...currentSelection, objectId];
      state.setActiveHierarchyTab('object');
      state.selectObjects(nextIds, nextIds.includes(objectId) ? objectId : (nextIds[0] ?? null));
      return;
    }

    if (isAddSelection) {
      const nextIds = currentSelection.includes(objectId)
        ? currentSelection
        : [...currentSelection, objectId];
      state.setActiveHierarchyTab('object');
      state.selectObjects(nextIds, objectId);
      return;
    }

    if (currentSelection.length > 1 && currentSelection.includes(objectId)) {
      // Keep multi-selection intact so immediate drag can move the whole selection.
      state.setActiveHierarchyTab('object');
      return;
    }

    state.setActiveHierarchyTab('object');
    state.selectObject(objectId);
  }, []);

  // Initialize Phaser
  useEffect(() => {
    if (!containerRef.current || !project) return;

    const cleanupPhaserInstance = (reason: string) => {
      const isStillPlaying = useEditorStore.getState().isPlaying;
      console.log(`[PhaserCanvas] Cleanup triggered (${reason}, isStillPlaying=${isStillPlaying})`);

      // During in-play scene sync (selectedSceneId changes while still playing),
      // keep the active runtime alive and skip full teardown.
      if (isStillPlaying && playModeInitialSceneRef.current !== null) {
        console.log('[PhaserCanvas] Skipping cleanup - still in active play session');
        return;
      }

      // Clear play mode tracking
      playModeInitialSceneRef.current = null;

      // Clear shared global variables when play session ends
      clearSharedGlobalVariables();

      // Clean up all scene runtimes (for multi-scene play mode)
      for (const [sceneId, runtime] of sceneRuntimes) {
        try {
          runtime.cleanup();
        } catch (e) {
          console.warn(`[PhaserCanvas] Error cleaning up runtime for scene ${sceneId}:`, e);
        }
      }
      sceneRuntimes.clear();

      if (runtimeRef.current) {
        runtimeRef.current.cleanup();
        setCurrentRuntime(null);
        runtimeRef.current = null;
      }
      setActiveRuntime(null);
      setInventoryItems([]);
      setDraggedInventoryItem(null);
      if (gameRef.current) {
        // Stop all sounds before destroying to prevent AudioContext errors
        try {
          const sceneManager = gameRef.current.scene;
          sceneManager.getScenes(true).forEach(scene => {
            if (scene?.sound) {
              scene.sound.stopAll();
              scene.sound.removeAll();
            }
          });
        } catch {
          // Ignore - scene might not exist
        }
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };

    // In play mode, only recreate game when play mode starts (not when selectedSceneId changes)
    // Check if this is just a scene change during an active play session
    const isSceneChangeInPlayMode = isPlaying &&
      playModeInitialSceneRef.current !== null &&
      gameRef.current;

    if (isSceneChangeInPlayMode) {
      console.log('[PhaserCanvas] Skipping game recreation - play mode already active, scene change handled internally');
      return () => cleanupPhaserInstance('scene-sync');
    }

    if (isPlaying) {
      // Store the initial scene for this play session
      playModeInitialSceneRef.current = selectedSceneId;
    } else {
      // Exiting play mode or in editor mode - clear the ref
      playModeInitialSceneRef.current = null;
    }

    // Use the initial scene for play mode, current scene for editor mode
    const effectiveSceneId = isPlaying ? (playModeInitialSceneRef.current || selectedSceneId) : selectedSceneId;
    const effectiveScene = project.scenes.find(s => s.id === effectiveSceneId);

    // Increment creation ID - any previous async creation attempts will be ignored
    creationIdRef.current++;
    const thisCreationId = creationIdRef.current;

    console.log(`[PhaserCanvas] Starting init #${thisCreationId}, isPlaying=${isPlaying}, effectiveSceneId=${effectiveSceneId}`);

    // Clean up existing game
    if (runtimeRef.current) {
      console.log('[PhaserCanvas] Cleaning up existing runtime');
      runtimeRef.current.cleanup();
      setCurrentRuntime(null);
      runtimeRef.current = null;
    }
    setActiveRuntime(null);
    if (gameRef.current) {
      console.log('[PhaserCanvas] Destroying existing game');
      // Stop all sounds before destroying to prevent AudioContext errors
      try {
        // Try to stop sounds on all active scenes
        const sceneManager = gameRef.current.scene;
        sceneManager.getScenes(true).forEach(scene => {
          if (scene?.sound) {
            scene.sound.stopAll();
            scene.sound.removeAll();
          }
        });
      } catch {
        // Ignore - scene might not exist
      }
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

    const { canvasWidth, canvasHeight, backgroundColor } = project.settings;
    const editorShellBackgroundColor = getStageShellBackgroundColor(viewMode, selectedScene?.background);
    const container = containerRef.current;

    // Function to create the game
    const createGame = () => {
      // Check if this creation attempt is still current
      if (thisCreationId !== creationIdRef.current) {
        console.log(`[PhaserCanvas] Skipping stale creation #${thisCreationId}, current is #${creationIdRef.current}`);
        return;
      }
      if (!container) return;
      console.log(`[PhaserCanvas] Creating game #${thisCreationId}`);

      // Editor mode uses container size for infinite canvas, play mode uses game dimensions
      const containerSize = getElementRenderSize(container);
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: container,
        width: isPlaying ? canvasWidth : containerSize.width,
        height: isPlaying ? canvasHeight : containerSize.height,
        render: isPlaying ? undefined : {
          preserveDrawingBuffer: true,
        },
        // Keep canvas outside camera viewport black so letterboxing is always consistent.
        backgroundColor: isPlaying ? backgroundColor : editorShellBackgroundColor,
        scale: isPlaying ? {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        } : {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.NO_CENTER,
        },
        physics: {
          default: 'matter',
          matter: {
            gravity: { x: 0, y: 1 }, // Default gravity, scaled per-body
            debug: (!isPlaying || showColliderOutlines) ? {
              showBody: true,
              showStaticBody: true,
              renderFill: false,
              renderLine: true,
              lineColor: 0x00ff00,
              lineThickness: 2,
              staticLineColor: 0x00ff00,
              fillColor: 0x00ff00,
              staticFillColor: 0x00ff00,
            } : false,
          },
        },
        scene: {
          // Use consistent scene key format: PlayScene_${sceneId} for all scenes
          key: isPlaying ? `PlayScene_${effectiveSceneId}` : 'EditorScene',
          preload: function(this: Phaser.Scene) {
            // Preload assets if needed
          },
          create: function(this: Phaser.Scene) {
            if (isPlaying) {
              // Collect all objects from all scenes for variable lookup
              const allObjects = project.scenes.flatMap(s => s.objects);
              createPlayScene(
                this,
                effectiveScene,
                project.scenes,
                project.components || [],
                runtimeRef,
                canvasWidth,
                canvasHeight,
                project.globalVariables,
                allObjects,
                effectiveSceneId || undefined,
                setActiveRuntime,
              );
            } else {
              // Get current viewMode from store
              const { viewMode: currentViewMode } = useEditorStore.getState();
              createEditorScene(
                this,
                selectedScene,
                selectObjects,
                selectedObjectId,
                selectedObjectIds,
                handleStageObjectPointerDown,
                handleObjectDragEnd,
                canvasWidth,
                canvasHeight,
                project.components || [],
                currentViewMode,
                getStoredEditorViewport(selectedScene?.id ?? null, { width: canvasWidth, height: canvasHeight }),
                (nextViewport) => {
                  storeEditorViewport(selectedScene?.id ?? null, nextViewport);
                },
              );
            }
          },
          update: function(this: Phaser.Scene) {
            const tiledBackgroundLayer = this.data.get('tiledBackgroundLayer') as TiledBackgroundLayerState | undefined;
            if (tiledBackgroundLayer) {
              updateTiledBackgroundLayer(this, tiledBackgroundLayer);
            }

            if (isPlaying && runtimeRef.current) {
              runtimeRef.current.update();

              // Check for scene switch
              const pendingSwitch = runtimeRef.current.pendingSceneSwitch;
              if (pendingSwitch) {
                const targetSceneData = resolveSceneByReference(project.scenes, pendingSwitch.sceneRef);
                if (targetSceneData) {
                  runtimeRef.current.clearPendingSceneSwitch();
                  // Use consistent scene key format for all scenes
                  const currentSceneKey = `PlayScene_${effectiveSceneId}`;
                  const targetSceneKey = `PlayScene_${targetSceneData.id}`;

                  // Pause current runtime and sleep current scene
                  runtimeRef.current.pause();

                  // Check if target scene already exists (was visited before)
                  const existingRuntime = sceneRuntimes.get(targetSceneData.id);

                  if (existingRuntime && !pendingSwitch.restart) {
                    // Resume existing scene
                    this.scene.sleep(currentSceneKey);
                    this.scene.wake(targetSceneKey);
                    runtimeRef.current = existingRuntime;
                    existingRuntime.resume();
                    setCurrentRuntime(existingRuntime);
                    setActiveRuntime(existingRuntime);
                  } else {
                    // Start new scene (or restart)
                    if (existingRuntime) {
                      // Clean up old runtime if restarting
                      existingRuntime.cleanup();
                      sceneRuntimes.delete(targetSceneData.id);
                      this.scene.stop(targetSceneKey);
                    }

                    // Sleep current scene
                    this.scene.sleep(currentSceneKey);

                    // Launch target scene if not already added, or start if restarting
                    if (!this.scene.get(targetSceneKey)) {
                      // Add new scene dynamically
                      this.scene.add(targetSceneKey, createPlaySceneConfig(
                        targetSceneData,
                        project.scenes,
                        project.components || [],
                        runtimeRef,
                        canvasWidth,
                        canvasHeight,
                        project.globalVariables,
                        project.scenes.flatMap(s => s.objects),
                        targetSceneData.id,
                        setActiveRuntime,
                      ), true);
                    } else {
                      this.scene.start(targetSceneKey);
                    }
                  }

                  // Update editor's selected scene to sync UI
                  selectScene(targetSceneData.id, { recordHistory: false });
                }
              }
            }
          },
        },
      };

      gameRef.current = new Phaser.Game(config);
      console.log(`[PhaserCanvas] Game #${thisCreationId} created`);

      // Force scale refresh after a frame to ensure proper sizing
      requestAnimationFrame(() => {
        if (gameRef.current?.scale) {
          gameRef.current.scale.refresh();
        }
      });
    };

    // In play mode, wait for layout to settle before creating game
    if (isPlaying) {
      // Use requestAnimationFrame to wait for CSS layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          createGame();
        });
      });
    } else {
      createGame();
    }

    return () => cleanupPhaserInstance('effect-dispose');
  }, [
    getStoredEditorViewport,
    handleObjectDragEnd,
    isPlaying,
    project?.id,
    project?.settings.canvasHeight,
    project?.settings.canvasWidth,
    selectedSceneId,
    storeEditorViewport,
  ]);

  useEffect(() => {
    if (isPlaying || !containerRef.current || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      syncEditorCanvasToHost();
    });
    observer.observe(containerRef.current);
    syncEditorCanvasToHost();

    return () => {
      observer.disconnect();
    };
  }, [isPlaying, project?.id, selectedSceneId, syncEditorCanvasToHost]);

  useLayoutEffect(() => {
    if (isPlaying) {
      return;
    }

    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let timeoutId: ReturnType<typeof window.setTimeout> | null = null;

    const syncNow = (force = false) => {
      if (!cancelled) {
        syncEditorCanvasToHost(force);
      }
    };

    syncNow(true);
    raf1 = window.requestAnimationFrame(() => {
      syncNow(true);
      raf2 = window.requestAnimationFrame(() => {
        syncNow(true);
      });
    });
    timeoutId = window.setTimeout(() => {
      syncNow(true);
    }, 120);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isPlaying, layoutMode, syncEditorCanvasToHost]);

  useEffect(() => {
    if (isPlaying) {
      setFrozenStageFrame(null);
      return;
    }

    const canvas = gameRef.current?.canvas;
    if (!canvas) return;

    if (isResizeFrozen) {
      try {
        const frozenFrame = captureFrozenStageFrame();
        if (frozenFrame) {
          setFrozenStageFrame(frozenFrame);
          canvas.style.visibility = 'hidden';
          return;
        }
        setFrozenStageFrame(null);
        canvas.style.visibility = 'visible';
      } catch {
        setFrozenStageFrame(null);
        canvas.style.visibility = 'visible';
      }
      return;
    }

    const revealCanvas = requestAnimationFrame(() => {
      const nextCanvas = gameRef.current?.canvas;
      if (nextCanvas) {
        nextCanvas.style.visibility = 'visible';
      }
      setFrozenStageFrame(null);
    });

    return () => {
      cancelAnimationFrame(revealCanvas);
    };
  }, [captureFrozenStageFrame, isResizeFrozen, isPlaying]);

  useEffect(() => {
    if (isPlaying) return;

    const handleResizeFreeze = (event: Event) => {
      const customEvent = event as CustomEvent<{ active?: boolean }>;
      const active = !!customEvent.detail?.active;
      immediateResizeFreezeRef.current = active;

      const canvas = gameRef.current?.canvas;
      if (active && canvas) {
        let frozenFrame: FrozenStageFrame | null = null;
        try {
          frozenFrame = captureFrozenStageFrame();
        } catch {
          frozenFrame = null;
        }

        flushSync(() => {
          setFrozenStageFrame(frozenFrame);
          setManualResizeFreezeActive(true);
        });
        canvas.style.visibility = frozenFrame ? 'hidden' : 'visible';
        return;
      }

      setManualResizeFreezeActive(active);
    };

    window.addEventListener(EDITOR_RESIZE_FREEZE_EVENT, handleResizeFreeze as EventListener);
    return () => {
      window.removeEventListener(EDITOR_RESIZE_FREEZE_EVENT, handleResizeFreeze as EventListener);
    };
  }, [captureFrozenStageFrame, isPlaying]);

  // Toggle collider debug rendering at runtime (without recreating game)
  useEffect(() => {
    if (!gameRef.current) return;

    // Get the active scene - could be EditorScene or PlayScene_${sceneId}
    const sceneKey = isPlaying ? `PlayScene_${selectedSceneId}` : 'EditorScene';
    const phaserScene = gameRef.current.scene.getScene(sceneKey) as Phaser.Scene;
    if (!phaserScene?.matter?.world) return;

    const world = phaserScene.matter.world;
    const shouldShowDebug = !isPlaying || showColliderOutlines;

    if (shouldShowDebug && !world.debugGraphic) {
      // Enable debug - create debug graphic if it doesn't exist
      world.createDebugGraphic();
      world.drawDebug = true;
    } else if (shouldShowDebug && world.debugGraphic) {
      world.debugGraphic.setVisible(true);
      world.drawDebug = true;
    } else if (!shouldShowDebug && world.debugGraphic) {
      world.debugGraphic.setVisible(false);
      world.drawDebug = false;
    }
  }, [isPlaying, showColliderOutlines, selectedSceneId]);

  // Update view mode at runtime (without recreating game)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    if (!phaserScene) return;

    const controller = getStageViewportController(phaserScene);
    controller?.setMode(viewMode);

    const shellBgColorValue = getStageShellBackgroundColor(viewMode, selectedScene?.background);

    const renderer = phaserScene.game.renderer as { config?: { backgroundColor?: Phaser.Display.Color } };
    if (renderer.config) {
      renderer.config.backgroundColor = Phaser.Display.Color.ValueToColor(shellBgColorValue);
    }
    if (phaserScene.game.canvas) {
      phaserScene.game.canvas.style.backgroundColor = shellBgColorValue;
    }

    refreshTiledBackgroundLayer(phaserScene);
  }, [viewMode, isPlaying, selectedScene?.background]);

  // Update objects when they change (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;
    const selectedIds = new Set(
      selectedObjectIdsRef.current.length > 0
        ? selectedObjectIdsRef.current
        : (selectedObjectIdRef.current ? [selectedObjectIdRef.current] : []),
    );

    // Get current object IDs in scene data
    const sceneObjectIds = new Set(selectedScene.objects.map(o => o.id));

    // Remove objects that no longer exist in scene data
    const toRemove: Phaser.GameObjects.Container[] = [];
    phaserScene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Container && child.getData('objectData')) {
        if (!sceneObjectIds.has(child.name)) {
          toRemove.push(child);
        }
      }
    });
    toRemove.forEach((container) => destroyEditorContainer(phaserScene, container));

    // Update or create objects (reverse depth so top of list = top render)
    const orderedSceneObjects = getSceneObjectsInLayerOrder(selectedScene);
    const objectCount = orderedSceneObjects.length;
    orderedSceneObjects.forEach((obj, index) => {
      let container = phaserScene.children.getByName(obj.id) as Phaser.GameObjects.Container | undefined;

      // Get effective props (resolves component references)
      const components = project?.components || [];
      const effectiveProps = getEffectiveObjectProps(obj, components);

      if (!container) {
        // Create new object
        const cw = phaserScene.data.get('canvasWidth') as number || 800;
        const ch = phaserScene.data.get('canvasHeight') as number || 600;
        const newContainer = createObjectVisual(phaserScene, obj, true, cw, ch, components); // true = editor mode
        container = newContainer;
        const isSelected = selectedIds.has(obj.id);
        newContainer.setData('selected', isSelected);

        const setSelectionVisible = (visible: boolean) => {
          const selRect = newContainer.getByName('selection') as Phaser.GameObjects.Rectangle;
          if (selRect) selRect.setVisible(visible);

          // Per-object gizmo handles stay disabled; stage transforms use the shared global selection gizmo.
          for (const name of [...GIZMO_HANDLE_NAMES, 'rotate_line']) {
            const handle = newContainer.getByName(name);
            if (handle) (handle as Phaser.GameObjects.Shape | Phaser.GameObjects.Graphics).setVisible(false);
          }
        };
        newContainer.setData('setSelectionVisible', setSelectionVisible);

        // Set initial selection visibility
        setSelectionVisible(false);

        let dragContext: {
          leaderStartX: number;
          leaderStartY: number;
          objectIds: string[];
          startPositions: Map<string, { x: number; y: number }>;
        } | null = null;

        newContainer.on('dragstart', () => {
          const storeState = useEditorStore.getState();
          const selectedIds = storeState.selectedObjectIds.length > 0
            ? storeState.selectedObjectIds
            : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
          const orderedSceneObjectIds = getOrderedObjectIdsForActiveScene(
            orderedSceneObjects.map((sceneObj) => sceneObj.id),
          );
          const dragIds = (selectedIds.length > 1 && selectedIds.includes(obj.id))
            ? orderedSceneObjectIds.filter((id) => selectedIds.includes(id))
            : [obj.id];
          const startPositions = new Map<string, { x: number; y: number }>();
          for (const id of dragIds) {
            const selectedContainer = phaserScene.children.getByName(id) as Phaser.GameObjects.Container | null;
            if (selectedContainer) {
              startPositions.set(id, { x: selectedContainer.x, y: selectedContainer.y });
            }
          }
          dragContext = {
            leaderStartX: newContainer.x,
            leaderStartY: newContainer.y,
            objectIds: dragIds,
            startPositions,
          };
        });

        newContainer.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
          if (dragContext) {
            const dx = dragX - dragContext.leaderStartX;
            const dy = dragY - dragContext.leaderStartY;
            for (const id of dragContext.objectIds) {
              const selectedContainer = phaserScene.children.getByName(id) as Phaser.GameObjects.Container | null;
              const startPos = dragContext.startPositions.get(id);
              if (selectedContainer && startPos) {
                selectedContainer.x = startPos.x + dx;
                selectedContainer.y = startPos.y + dy;
              }
            }
            return;
          }
          newContainer.x = dragX;
          newContainer.y = dragY;
        });

        newContainer.on('dragend', () => {
          if (dragContext) {
            const currentDragContext = dragContext;
            runInHistoryTransaction('stage:drag-selection', () => {
              for (const id of currentDragContext.objectIds) {
                const selectedContainer = phaserScene.children.getByName(id) as Phaser.GameObjects.Container | null;
                if (selectedContainer) {
                  handleObjectDragEnd(id, selectedContainer.x, selectedContainer.y);
                }
              }
            });
            dragContext = null;
            return;
          }
          runInHistoryTransaction('stage:drag-object', () => {
            handleObjectDragEnd(obj.id, newContainer.x, newContainer.y);
          });
        });
      } else {
        const targetContainer = container;
        targetContainer.setData('objectData', obj);
        const selectionRect = targetContainer.getByName('selection') as Phaser.GameObjects.Rectangle | null;
        if (selectionRect) {
          const selectionPalette = getStageGizmoPaletteForObject(obj);
          selectionRect.setStrokeStyle(GIZMO_STROKE_PX, selectionPalette.phaserColor);
          selectionRect.setFillStyle(selectionPalette.phaserColor, STAGE_SELECTION_FILL_ALPHA);
        }
        // Update existing object - convert user coords to Phaser coords
        const cw = phaserScene.data.get('canvasWidth') as number || 800;
        const ch = phaserScene.data.get('canvasHeight') as number || 600;
        const phaserPos = userToPhaser(obj.x, obj.y, cw, ch);
        targetContainer.setPosition(phaserPos.x, phaserPos.y);
        targetContainer.setScale(obj.scaleX, obj.scaleY);
        targetContainer.setRotation(Phaser.Math.DegToRad(obj.rotation));
        targetContainer.setVisible(obj.visible);

        // Update costume if changed (use effective props for component instances)
        const costumes = effectiveProps.costumes || [];
        const currentCostumeIndex = effectiveProps.currentCostumeIndex ?? 0;
        const currentCostume = costumes[currentCostumeIndex];
        const storedCostumeId = targetContainer.getData('costumeId');
        const storedAssetId = targetContainer.getData('assetId');
        const storedAssetFrame = targetContainer.getData('assetFrame') as CostumeAssetFrame | null | undefined;
        const storedBounds = targetContainer.getData('bounds') as CostumeBounds | null | undefined;
        const pendingVisualTarget = getPendingCostumeVisualTarget(targetContainer);
        const resolvedCostumeId = pendingVisualTarget?.costumeId ?? storedCostumeId;
        const resolvedAssetId = pendingVisualTarget?.assetId ?? storedAssetId;
        const resolvedAssetFrame = pendingVisualTarget?.assetFrame ?? storedAssetFrame;

        const hasCurrentCostumeAsset = !!currentCostume?.assetId;
        const hadResolvedCostumeAsset = !!resolvedAssetId;
        const currentBounds = currentCostume?.bounds ?? null;
        const currentAssetFrame = currentCostume?.assetFrame ?? null;

        // Update when costume content changes or when switching between placeholder <-> costume
        const costumeChanged = hasCurrentCostumeAsset !== hadResolvedCostumeAsset || (
          hasCurrentCostumeAsset && (
            currentCostume.id !== resolvedCostumeId ||
            currentCostume.assetId !== resolvedAssetId
          )
        );
        const costumeLayoutChanged = hasCurrentCostumeAsset && (
          !areCostumeBoundsEqual(currentBounds, storedBounds) ||
          !areCostumeAssetFramesEqual(currentAssetFrame, resolvedAssetFrame)
        );

        if (costumeChanged || costumeLayoutChanged) {
          const nextVisualVersion = ((targetContainer.getData('costumeVisualVersion') as number | undefined) ?? 0) + 1;
          targetContainer.setData('costumeVisualVersion', nextVisualVersion);

          // Helper to update container with new sprite using bounds
          const updateWithSprite = (
            sprite: Phaser.GameObjects.Image,
            cont: Phaser.GameObjects.Container,
            bounds: { x: number; y: number; width: number; height: number } | null | undefined,
            assetFrame?: CostumeAssetFrame | null,
          ) => {
            sprite.setName('sprite');
            cont.add(sprite);
            const hitRect = cont.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
            const selRect = cont.getByName('selection') as Phaser.GameObjects.Rectangle | null;
            const metrics = getCostumeVisualMetrics({
              bounds,
              assetFrame,
              imageWidth: sprite.width,
              imageHeight: sprite.height,
            });

            sprite.setPosition(metrics.assetOffset.x, metrics.assetOffset.y);
            cont.setSize(metrics.interactionWidth, metrics.interactionHeight);

            if (hitRect) {
              hitRect.setSize(metrics.interactionWidth, metrics.interactionHeight);
              hitRect.setPosition(metrics.interactionOffset.x, metrics.interactionOffset.y);
              hitRect.removeInteractive();
              hitRect.setInteractive({ useHandCursor: true });
            }

            if (selRect) {
              selRect.setSize(metrics.interactionWidth + 8, metrics.interactionHeight + 8);
              selRect.setPosition(metrics.interactionOffset.x, metrics.interactionOffset.y);
              cont.sendToBack(selRect);
            }
          };

          const replaceCurrentVisual = (
            applyNextVisual: () => void,
            nextTextureKey?: string | null,
          ) => {
            const existingSprite = targetContainer.getByName('sprite') as Phaser.GameObjects.Image | null;
            const existingPlaceholder = targetContainer.getByName('placeholder') as Phaser.GameObjects.Graphics | null;
            const previousTextureKey = targetContainer.getData('textureKey') as string | undefined;

            if (existingSprite) {
              existingSprite.destroy();
            }
            if (existingPlaceholder) {
              existingPlaceholder.destroy();
            }

            applyNextVisual();
            targetContainer.setData('pendingVisualTarget', undefined);

            if (
              previousTextureKey &&
              previousTextureKey !== nextTextureKey &&
              previousTextureKey.startsWith('costume_') &&
              phaserScene.textures.exists(previousTextureKey)
            ) {
              phaserScene.textures.remove(previousTextureKey);
            }
          };

          const applyPlaceholderVisual = () => {
            const graphics = phaserScene.add.graphics();
            graphics.setName('placeholder');
            const color = getObjectColor(obj.id);
            graphics.fillStyle(color, 1);
            graphics.fillRoundedRect(-32, -32, 64, 64, 8);
            graphics.lineStyle(2, 0x333333);
            graphics.strokeRoundedRect(-32, -32, 64, 64, 8);
            targetContainer.add(graphics);
            targetContainer.setSize(64, 64);

            const hitRect = targetContainer.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
            if (hitRect) {
              hitRect.setSize(64, 64);
              hitRect.setPosition(0, 0);
              hitRect.removeInteractive();
              hitRect.setInteractive({ useHandCursor: true });
              targetContainer.bringToTop(hitRect);
            }

            const selRect = targetContainer.getByName('selection') as Phaser.GameObjects.Rectangle | null;
            if (selRect) {
              selRect.setSize(72, 72);
              selRect.setPosition(0, 0);
              targetContainer.sendToBack(selRect);
            }
          };

          const commitCostumeSpriteVisual = (costume: Costume, textureKey: string) => {
            if (!targetContainer.active || !targetContainer.scene) {
              return;
            }
            if ((targetContainer.getData('costumeVisualVersion') as number | undefined) !== nextVisualVersion) {
              return;
            }
            if (!phaserScene.textures.exists(textureKey)) {
              return;
            }

            const sprite = phaserScene.add.image(0, 0, textureKey);
            replaceCurrentVisual(() => {
              targetContainer.setData('costumeId', costume.id);
              targetContainer.setData('assetId', costume.assetId);
              targetContainer.setData('assetFrame', costume.assetFrame ?? null);
              targetContainer.setData('textureKey', textureKey);
              targetContainer.setData('bounds', costume.bounds);
              updateWithSprite(sprite, targetContainer, costume.bounds, costume.assetFrame);
            }, textureKey);
          };

          if (!hasCurrentCostumeAsset || !currentCostume) {
            replaceCurrentVisual(() => {
              targetContainer.setData('costumeId', null);
              targetContainer.setData('assetId', null);
              targetContainer.setData('assetFrame', null);
              targetContainer.setData('textureKey', null);
              targetContainer.setData('bounds', null);
              applyPlaceholderVisual();
            }, null);
          } else {
            const textureKey = getCostumeTextureKey(obj.id, currentCostume.id, currentCostume.assetId);
            targetContainer.setData('pendingVisualTarget', {
              costumeId: currentCostume.id,
              assetId: currentCostume.assetId,
              assetFrame: currentCostume.assetFrame ?? null,
              textureKey,
            } satisfies PendingCostumeVisualTarget);
            if (phaserScene.textures.exists(textureKey)) {
              commitCostumeSpriteVisual(currentCostume, textureKey);
            } else {
              void loadImageSource(currentCostume.assetId).then((img) => {
                if (!targetContainer.active || !targetContainer.scene) return;
                if ((targetContainer.getData('costumeVisualVersion') as number | undefined) !== nextVisualVersion) {
                  return;
                }
                const currentPendingTarget = getPendingCostumeVisualTarget(targetContainer);
                if (
                  currentPendingTarget?.costumeId !== currentCostume.id ||
                  currentPendingTarget?.assetId !== currentCostume.assetId ||
                  !areCostumeAssetFramesEqual(currentPendingTarget?.assetFrame, currentCostume.assetFrame ?? null) ||
                  currentPendingTarget?.textureKey !== textureKey
                ) {
                  return;
                }
                if (!phaserScene.textures.exists(textureKey)) {
                  phaserScene.textures.addImage(textureKey, img);
                }
                commitCostumeSpriteVisual(currentCostume, textureKey);
              }).catch((error) => {
                console.warn('Failed to load costume texture source for stage sprite update.', error);
              });
            }
          }
        }
      }

      // Update z-depth based on array index (top of list = highest depth = renders on top)
      container.setDepth(objectCount - index);

      // Update selection visual
      const isSelected = selectedIds.has(obj.id);
      container.setData('selected', isSelected);

      const setSelectionVisible = container.getData('setSelectionVisible') as ((visible: boolean) => void) | undefined;
      if (setSelectionVisible) {
        setSelectionVisible(false);
      } else {
        const selectionRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
        if (selectionRect) {
          selectionRect.setVisible(false);
        }
      }
    });
  }, [selectedScene?.objects, isPlaying, handleObjectDragEnd, project?.components, viewMode]);

  // Update background color when it changes (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;

    const bgColorValue = getSceneBackgroundBaseColor(selectedScene.background);
    const shellBgColorValue = getStageShellBackgroundColor(viewMode, selectedScene.background);

    phaserScene.cameras.main.setBackgroundColor(bgColorValue);

    const tiledBackgroundLayer = phaserScene.data.get('tiledBackgroundLayer') as TiledBackgroundLayerState | undefined;
    if (tiledBackgroundLayer) {
      tiledBackgroundLayer.background = selectedScene.background ?? null;
      refreshTiledBackgroundLayer(phaserScene);
    }

    if (gameRef.current?.canvas) {
      gameRef.current.canvas.style.backgroundColor = shellBgColorValue;
    }

    // Update bounds graphics color to contrast with new background
    const boundsGraphics = phaserScene.data.get('boundsGraphics') as Phaser.GameObjects.Graphics | undefined;
    if (boundsGraphics) {
      const canvasWidth = phaserScene.data.get('canvasWidth') as number;
      const canvasHeight = phaserScene.data.get('canvasHeight') as number;

      const bgColor = Phaser.Display.Color.HexStringToColor(bgColorValue);
      const luminance = (0.299 * bgColor.red + 0.587 * bgColor.green + 0.114 * bgColor.blue) / 255;
      const borderColor = luminance < 0.5 ? 0xffffff : 0x333333;

      boundsGraphics.clear();
      boundsGraphics.lineStyle(1, borderColor, 0.5);
      boundsGraphics.strokeRect(0, 0, canvasWidth, canvasHeight);
    }
  }, [selectedScene?.background, isPlaying, viewMode]);

  // Update ground when it changes (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying || !project) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;

    const groundGraphics = phaserScene.data.get('groundGraphics') as Phaser.GameObjects.Graphics | undefined;
    if (groundGraphics) {
      groundGraphics.clear();

      if (selectedScene.ground?.enabled) {
        const groundColor = Phaser.Display.Color.HexStringToColor(selectedScene.ground.color || '#8B4513');
        const userGroundY = selectedScene.ground.y ?? -200;
        // Convert user Y to Phaser Y (user Y is up-positive, Phaser Y is down-positive)
        const phaserGroundY = project.settings.canvasHeight / 2 - userGroundY;
        const groundHeight = 2000;
        const groundWidth = 10000;
        groundGraphics.fillStyle(groundColor.color, 1);
        groundGraphics.fillRect(-groundWidth / 2, phaserGroundY, groundWidth, groundHeight);
      }
    }
  }, [selectedScene?.ground, isPlaying, project]);

  useEffect(() => {
    if (!gameRef.current || isPlaying || !project) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;

    const worldBoundaryGraphics = phaserScene.data.get('worldBoundaryGraphics') as Phaser.GameObjects.Graphics | undefined;
    if (!worldBoundaryGraphics) return;

    drawWorldBoundary(worldBoundaryGraphics, selectedScene, project.settings.canvasWidth, project.settings.canvasHeight);
  }, [selectedScene?.worldBoundary, isPlaying, project]);

  const totalInventoryPages = Math.max(1, Math.ceil(inventoryItems.length / INVENTORY_PAGE_SIZE));
  const visibleInventoryItems = inventoryItems.slice(
    inventoryPage * INVENTORY_PAGE_SIZE,
    (inventoryPage + 1) * INVENTORY_PAGE_SIZE,
  );
  const canGoToPreviousInventoryPage = totalInventoryPages > 1 && inventoryPage > 0;
  const canGoToNextInventoryPage = totalInventoryPages > 1 && inventoryPage < totalInventoryPages - 1;
  const editorStageShellColor = getStageShellBackgroundColor(viewMode, selectedScene?.background);
  const handleShortcutSurfacePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isPlaying) {
      return;
    }
    focusKeyboardSurface(event.currentTarget);
  }, [isPlaying]);

  const handleComponentDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (isPlaying || !event.dataTransfer.types.includes('application/x-pocha-component-id')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (!containerRef.current || !gameRef.current || !project) {
      return;
    }

    const componentId = event.dataTransfer.getData('application/x-pocha-component-id') || getDraggedComponentId();
    if (!componentId) {
      setComponentDragPreview(null);
      return;
    }

    const component = (project.components || []).find((candidate) => candidate.id === componentId);
    const costume = component?.costumes[component.currentCostumeIndex] ?? component?.costumes[0] ?? null;
    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    const camera = phaserScene?.cameras?.main;
    if (!component || !camera) {
      setComponentDragPreview(null);
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    setComponentDragPreview({
      componentId,
      localX: event.clientX - rect.left,
      localY: event.clientY - rect.top,
      bounds: costume?.bounds ?? null,
      assetId: costume?.assetId ?? null,
      assetFrame: costume?.assetFrame ?? null,
      zoom: camera.zoom,
    });
  }, [isPlaying, project]);

  const handleComponentDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!componentDragPreview || !containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const isOutside = event.clientX < rect.left
      || event.clientX > rect.right
      || event.clientY < rect.top
      || event.clientY > rect.bottom;

    if (isOutside) {
      setComponentDragPreview(null);
    }
  }, [componentDragPreview]);

  const handleComponentDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (isPlaying) {
      return;
    }
    const componentId = event.dataTransfer.getData('application/x-pocha-component-id') || getDraggedComponentId();
    if (!componentId || !selectedSceneId || !project || !containerRef.current || !gameRef.current) {
      return;
    }

    event.preventDefault();
    setComponentDragPreview(null);
    setDraggedComponentId(null);
    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    const camera = phaserScene?.cameras?.main;
    if (!camera) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const worldPoint = camera.getWorldPoint(localX, localY);
    const userPoint = phaserToUser(
      worldPoint.x,
      worldPoint.y,
      project.settings.canvasWidth,
      project.settings.canvasHeight,
    );

    runInHistoryTransaction('stage:drop-component-instance', () => {
      const createdObject = addComponentInstance(selectedSceneId, componentId);
      if (!createdObject) {
        return;
      }
      updateObject(selectedSceneId, createdObject.id, {
        x: userPoint.x,
        y: userPoint.y,
      });
      selectObjects([createdObject.id], createdObject.id);
    });
  }, [addComponentInstance, isPlaying, project, selectObjects, selectedSceneId, updateObject]);

  useEffect(() => {
    if (isPlaying) {
      setComponentDragPreview(null);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!componentDragPreview) {
      return;
    }

    const handleWindowDragOver = (event: DragEvent) => {
      const container = containerRef.current;
      if (!container) {
        setComponentDragPreview(null);
        return;
      }

      const rect = container.getBoundingClientRect();
      const isOutside = event.clientX < rect.left
        || event.clientX > rect.right
        || event.clientY < rect.top
        || event.clientY > rect.bottom;

      if (isOutside) {
        setComponentDragPreview(null);
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
    };
  }, [componentDragPreview]);

  useEffect(() => {
    const handleWindowDragEnd = () => {
      setComponentDragPreview(null);
      setDraggedComponentId(null);
    };

    window.addEventListener('dragend', handleWindowDragEnd);
    return () => {
      window.removeEventListener('dragend', handleWindowDragEnd);
    };
  }, []);

  const previewZoom = componentDragPreview?.zoom ?? 1;
  const previewMetrics = componentDragPreview
    ? getCostumeVisualMetrics({
        bounds: componentDragPreview.bounds,
        assetFrame: componentDragPreview.assetFrame,
        imageWidth: componentDragPreview.assetFrame?.width ?? COSTUME_CANVAS_SIZE,
        imageHeight: componentDragPreview.assetFrame?.height ?? COSTUME_CANVAS_SIZE,
      })
    : null;
  const previewWidth = previewMetrics
    ? Math.max(1, (previewMetrics.localBounds?.width ?? previewMetrics.imageWidth) * previewZoom)
    : Math.max(24, 64 * previewZoom);
  const previewHeight = previewMetrics
    ? Math.max(1, (previewMetrics.localBounds?.height ?? previewMetrics.imageHeight) * previewZoom)
    : Math.max(24, 64 * previewZoom);
  const previewCenterX = componentDragPreview
    ? componentDragPreview.localX + ((previewMetrics?.interactionOffset.x ?? 0) * previewZoom)
    : 0;
  const previewCenterY = componentDragPreview
    ? componentDragPreview.localY + ((previewMetrics?.interactionOffset.y ?? 0) * previewZoom)
    : 0;
  const previewComponentName = componentDragPreview
    ? ((project?.components || []).find((candidate) => candidate.id === componentDragPreview.componentId)?.name ?? 'Component')
    : 'Component';

  return (
    <div
      className="relative w-full h-full outline-none"
      data-editor-shortcut-surface={isPlaying ? undefined : 'scene-objects'}
      tabIndex={isPlaying ? -1 : 0}
      onPointerDownCapture={handleShortcutSurfacePointerDownCapture}
      onDragOver={handleComponentDragOver}
      onDragLeave={handleComponentDragLeave}
      onDrop={handleComponentDrop}
    >
      <div
        ref={containerRef}
        data-testid={isPlaying ? 'play-phaser-host' : 'stage-phaser-host'}
        className="w-full h-full"
        style={isPlaying ? undefined : { backgroundColor: editorStageShellColor }}
      />
      {!isPlaying && componentDragPreview ? (
        componentDragPreview.assetId ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-[12] overflow-hidden opacity-70 shadow-[0_0_0_1px_rgba(14,165,233,0.35)]"
            style={{
              left: previewCenterX,
              top: previewCenterY,
              width: previewWidth,
              height: previewHeight,
              transform: 'translate(-50%, -50%)',
              backgroundImage: `url(${componentDragPreview.assetId})`,
              backgroundPosition: previewMetrics?.localBounds
                ? `${-previewMetrics.localBounds.x * previewZoom}px ${-previewMetrics.localBounds.y * previewZoom}px`
                : '0 0',
              backgroundSize: `${(previewMetrics?.imageWidth ?? 64) * previewZoom}px ${(previewMetrics?.imageHeight ?? 64) * previewZoom}px`,
              backgroundRepeat: 'no-repeat',
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-[12] flex items-center justify-center border border-sky-500/50 bg-sky-500/10 px-2 text-xs font-medium text-sky-700 opacity-80 dark:text-sky-200"
            style={{
              left: previewCenterX,
              top: previewCenterY,
              width: previewWidth,
              height: previewHeight,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {previewComponentName}
          </div>
        )
      ) : null}
      {!isPlaying && frozenStageFrame ? (
        <img
          src={frozenStageFrame.src}
          alt=""
          aria-hidden="true"
          data-testid="stage-frozen-frame"
          className="pointer-events-none absolute z-10 select-none"
          style={{
            left: '50%',
            top: '50%',
            width: `${frozenStageFrame.width}px`,
            height: `${frozenStageFrame.height}px`,
            maxWidth: 'none',
            maxHeight: 'none',
            transform: 'translate3d(-50%, -50%, 0)',
            transformOrigin: 'center center',
          }}
          draggable={false}
        />
      ) : null}
      {isPlaying && isInventoryVisible && inventoryItems.length > 0 && (
        <>
          <div
            data-pocha-ui="inventory"
            className="absolute left-4 right-4 bottom-4 z-20 pointer-events-none"
          >
            <div className="pointer-events-auto mx-auto max-w-4xl rounded-2xl border bg-card/92 backdrop-blur px-3 py-3 shadow-lg">
              <div className="flex items-center gap-2">
                {canGoToPreviousInventoryPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInventoryPage((page) => Math.max(0, page - 1))}
                  >
                    ←
                  </Button>
                ) : null}
                <div className="flex-1 grid grid-cols-4 md:grid-cols-8 gap-2">
                  {visibleInventoryItems.map((item) => (
                    <button
                      key={item.entryId}
                      type="button"
                      disabled={item.isPendingUse}
                      aria-disabled={item.isPendingUse}
                      className={`group flex h-16 w-16 items-center justify-center rounded-xl border bg-background transition-opacity ${
                        item.isPendingUse
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:border-primary/60 hover:bg-muted/70'
                      }`}
                      onPointerDown={(event) => {
                        if (item.isPendingUse) {
                          event.preventDefault();
                          event.stopPropagation();
                          console.log('[InventoryDrop][UI] Drag blocked because item is pending use', {
                            entryId: item.entryId,
                            label: item.label,
                          });
                          return;
                        }
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setDraggedInventoryItem({
                          entry: item,
                          x: event.clientX,
                          y: event.clientY,
                          width: rect.width,
                          height: rect.height,
                        });
                      }}
                    >
                      {item.costumeAssetId ? (
                        <InventoryCostumePreview
                          assetId={item.costumeAssetId}
                          assetFrame={item.costumeAssetFrame}
                          bounds={item.costumeBounds}
                          label={item.label}
                        />
                      ) : (
                        <span className="px-2 text-[11px] text-center text-foreground/80 pointer-events-none">
                          {item.label}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {canGoToNextInventoryPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInventoryPage((page) => Math.min(totalInventoryPages - 1, page + 1))}
                  >
                    →
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {draggedInventoryItem && (
            <div
              className="fixed z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{ left: draggedInventoryItem.x, top: draggedInventoryItem.y }}
            >
              <div
                className={`flex items-center justify-center rounded-xl border bg-card/95 shadow-xl transition-opacity ${
                  draggedInventoryCanDrop ? 'opacity-100' : 'opacity-50'
                }`}
                style={{
                  width: draggedInventoryItem.width,
                  height: draggedInventoryItem.height,
                }}
              >
                {draggedInventoryItem.entry.costumeAssetId ? (
                  <InventoryCostumePreview
                    assetId={draggedInventoryItem.entry.costumeAssetId}
                    assetFrame={draggedInventoryItem.entry.costumeAssetFrame}
                    bounds={draggedInventoryItem.entry.costumeBounds}
                    label={draggedInventoryItem.entry.label}
                  />
                ) : (
                  <span className="px-2 text-[11px] text-center text-foreground/80">
                    {draggedInventoryItem.entry.label}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Create the editor scene (non-playing mode)
 */
function createEditorScene(
  scene: Phaser.Scene,
  sceneData: SceneData | undefined,
  selectObjects: (ids: string[], primaryObjectId?: string | null) => void,
  selectedObjectId: string | null,
  selectedObjectIds: string[],
  onObjectPointerDown: (pointer: Phaser.Input.Pointer, objectId: string) => void,
  onDragEnd: (objId: string, x: number, y: number, scaleX?: number, scaleY?: number, rotation?: number) => void,
  canvasWidth: number,
  canvasHeight: number,
  components: ComponentDefinition[] = [],
  viewMode: 'camera-masked' | 'camera-viewport' | 'editor' = 'editor',
  initialEditorViewport: StageEditorViewport,
  onEditorViewportChange: (viewport: StageEditorViewport) => void,
) {
  if (!sceneData) return;
  const getOrderedSceneObjectIds = () => getOrderedObjectIdsForActiveScene(
    getSceneObjectsInLayerOrder(sceneData).map((obj) => obj.id),
  );

  const camera = scene.cameras.main;

  // Set background color (same everywhere)
  const bgColorValue = getSceneBackgroundBaseColor(sceneData.background);
  camera.setBackgroundColor(bgColorValue);

  const tiledBackgroundLayer = createTiledBackgroundLayerState(
    scene,
    sceneData.background ?? null,
    canvasWidth,
    canvasHeight,
  );
  updateTiledBackgroundLayer(scene, tiledBackgroundLayer);

  // Calculate if background is dark to choose contrasting border color
  const bgColor = Phaser.Display.Color.HexStringToColor(bgColorValue);
  const luminance = (0.299 * bgColor.red + 0.587 * bgColor.green + 0.114 * bgColor.blue) / 255;
  const borderColor = luminance < 0.5 ? 0xffffff : 0x333333;

  // Draw game bounds rectangle with contrasting color
  const boundsGraphics = scene.add.graphics();
  boundsGraphics.lineStyle(1, borderColor, 0.5);
  boundsGraphics.strokeRect(0, 0, canvasWidth, canvasHeight);

  // Draw ground if enabled
  const groundGraphics = scene.add.graphics();
  groundGraphics.setDepth(GROUND_LAYER_DEPTH);
  if (sceneData.ground?.enabled) {
    const groundColor = Phaser.Display.Color.HexStringToColor(sceneData.ground.color || '#8B4513');
    const userGroundY = sceneData.ground.y ?? -200;
    // Convert user Y to Phaser Y (user Y is up-positive, Phaser Y is down-positive)
    const phaserGroundY = canvasHeight / 2 - userGroundY;
    const groundHeight = 2000;
    const groundWidth = 10000;
    groundGraphics.fillStyle(groundColor.color, 1);
    groundGraphics.fillRect(-groundWidth / 2, phaserGroundY, groundWidth, groundHeight);
  }

  const worldBoundaryGraphics = scene.add.graphics();
  worldBoundaryGraphics.setDepth(-900);
  drawWorldBoundary(worldBoundaryGraphics, sceneData, canvasWidth, canvasHeight);

  // Store references for dynamic updates
  scene.data.set('boundsGraphics', boundsGraphics);
  scene.data.set('groundGraphics', groundGraphics);
  scene.data.set('worldBoundaryGraphics', worldBoundaryGraphics);
  scene.data.set('canvasWidth', canvasWidth);
  scene.data.set('canvasHeight', canvasHeight);
  scene.data.set('tiledBackgroundLayer', tiledBackgroundLayer);
  scene.events.once('shutdown', () => {
    destroyTiledBackgroundLayer(scene, tiledBackgroundLayer);
  });

  const stageViewportController = createStageViewportController({
    scene,
    canvasSize: { width: canvasWidth, height: canvasHeight },
    initialMode: viewMode,
    initialEditorViewport,
    onEditorViewportChange,
  });
  onEditorViewportChange(stageViewportController.getEditorViewport());

  // Keep camera viewport in sync with stage panel resizes.
  const handleScaleResize = () => {
    stageViewportController.syncProjection();
    refreshTiledBackgroundLayer(scene);
  };
  scene.scale.on('resize', handleScaleResize);
  scene.events.once('shutdown', () => {
    scene.scale.off('resize', handleScaleResize);
  });

  // Enable camera panning with middle mouse or right mouse drag
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartViewport: StageEditorViewport | null = null;

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    // Middle mouse (button 1) or right mouse (button 2) starts panning (only in editor mode)
    const currentMode = stageViewportController.getMode();
    if (currentMode === 'editor' && (pointer.middleButtonDown() || pointer.rightButtonDown())) {
      isPanning = true;
      panStartX = pointer.x;
      panStartY = pointer.y;
      panStartViewport = stageViewportController.getEditorViewport();
    }
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (isPanning && panStartViewport) {
      stageViewportController.setEditorViewport(
        panStageEditorViewport(
          panStartViewport,
          pointer.x - panStartX,
          pointer.y - panStartY,
        ),
      );
    }
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.middleButtonDown() && !pointer.rightButtonDown()) {
      isPanning = false;
      panStartViewport = null;
    }
  });

  scene.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.middleButtonDown() && !pointer.rightButtonDown()) {
      isPanning = false;
      panStartViewport = null;
    }
    setLockedStageCursor(null);
    endTranslateDrag(pointer);
    if (isMarqueeSelecting && marqueePointerId === pointer.id) {
      endMarqueeSelection(pointer);
    }
  });

  scene.input.setTopOnly(true);

  const marqueeGraphics = scene.add.graphics();
  marqueeGraphics.setDepth(10_000);
  marqueeGraphics.setVisible(false);

  let isMarqueeSelecting = false;
  let marqueeStartX = 0;
  let marqueeStartY = 0;
  let marqueeHasMoved = false;
  let marqueePointerId: number | null = null;
  let marqueeMode: 'replace' | 'add' | 'toggle' = 'replace';
  let activeTranslateDrag: {
    pointerId: number;
    objectIds: string[];
    startWorldX: number;
    startWorldY: number;
    startPositions: Map<string, { x: number; y: number }>;
    hasMoved: boolean;
  } | null = null;
  const groupOverlayGraphics = scene.add.graphics();
  groupOverlayGraphics.setVisible(false);
  groupOverlayGraphics.setDepth(10_003);

  const groupHandles = new Map<string, Phaser.GameObjects.Shape | Phaser.GameObjects.Arc>();
  const createGroupHandle = (
    name: string,
    shape: Phaser.GameObjects.Shape | Phaser.GameObjects.Arc,
    cursor: string,
    options?: {
      interactiveAlpha?: number;
      showStroke?: boolean;
      hitArea?: Phaser.Geom.Circle | Phaser.Geom.Rectangle;
      hitAreaCallback?: Phaser.Types.Input.HitAreaCallback;
      depth?: number;
    },
  ) => {
    shape.setFillStyle(0xffffff, options?.interactiveAlpha ?? 0.001);
    if (options?.showStroke !== false) {
      shape.setStrokeStyle(1.5, STAGE_GIZMO_COLOR, 1);
    }
    shape.setName(name);
    shape.setVisible(false);
    shape.setDepth(options?.depth ?? 10_004);
    if (options?.hitArea && options.hitAreaCallback) {
      shape.setInteractive(options.hitArea, options.hitAreaCallback as any);
      if (shape.input) {
        shape.input.cursor = cursor;
      }
    } else {
      shape.setInteractive({ useHandCursor: false, cursor });
    }
    scene.input.setDraggable(shape);
    groupHandles.set(name, shape);
  };

  createGroupHandle(
    'handle_nw',
    scene.add.circle(0, 0, GIZMO_CORNER_HIT_RADIUS_PX, 0xffffff),
    getTransformGizmoCornerCursor('nw'),
    { interactiveAlpha: 0.001, showStroke: false, depth: 10_005 },
  );
  createGroupHandle(
    'handle_ne',
    scene.add.circle(0, 0, GIZMO_CORNER_HIT_RADIUS_PX, 0xffffff),
    getTransformGizmoCornerCursor('ne'),
    { interactiveAlpha: 0.001, showStroke: false, depth: 10_005 },
  );
  createGroupHandle(
    'handle_sw',
    scene.add.circle(0, 0, GIZMO_CORNER_HIT_RADIUS_PX, 0xffffff),
    getTransformGizmoCornerCursor('sw'),
    { interactiveAlpha: 0.001, showStroke: false, depth: 10_005 },
  );
  createGroupHandle(
    'handle_se',
    scene.add.circle(0, 0, GIZMO_CORNER_HIT_RADIUS_PX, 0xffffff),
    getTransformGizmoCornerCursor('se'),
    { interactiveAlpha: 0.001, showStroke: false, depth: 10_005 },
  );
  createGroupHandle(
    'handle_n',
    scene.add.rectangle(0, 0, 1, 1, 0xffffff),
    getTransformGizmoEdgeCursor('vertical'),
    { interactiveAlpha: 0.001, showStroke: false },
  );
  createGroupHandle(
    'handle_e',
    scene.add.rectangle(0, 0, 1, 1, 0xffffff),
    getTransformGizmoEdgeCursor('horizontal'),
    { interactiveAlpha: 0.001, showStroke: false },
  );
  createGroupHandle(
    'handle_s',
    scene.add.rectangle(0, 0, 1, 1, 0xffffff),
    getTransformGizmoEdgeCursor('vertical'),
    { interactiveAlpha: 0.001, showStroke: false },
  );
  createGroupHandle(
    'handle_w',
    scene.add.rectangle(0, 0, 1, 1, 0xffffff),
    getTransformGizmoEdgeCursor('horizontal'),
    { interactiveAlpha: 0.001, showStroke: false },
  );
  const createRotateGroupHandle = (name: string, corner: TransformGizmoCorner) => createGroupHandle(
    name,
    scene.add.circle(0, 0, GIZMO_ROTATE_RING_RADIUS_PX, 0xffffff, 0.001),
    getTransformGizmoRotateCursor(0, corner),
    {
      interactiveAlpha: 0.001,
      showStroke: false,
      depth: 10_006,
      hitArea: new Phaser.Geom.Circle(
        GIZMO_ROTATE_RING_RADIUS_PX,
        GIZMO_ROTATE_RING_RADIUS_PX,
        GIZMO_ROTATE_RING_RADIUS_PX,
      ),
      hitAreaCallback: ((hitArea: Phaser.Geom.Circle, x: number, y: number, gameObject: Phaser.GameObjects.GameObject) => {
        const frameRotation = Number(gameObject.getData('frameRotation') ?? 0);
        return isPointInsideTransformRotateRing(
          { x, y },
          { x: hitArea.x, y: hitArea.y },
          TRANSFORM_GIZMO_HANDLE_RADIUS,
          corner,
          frameRotation,
        );
      }) as Phaser.Types.Input.HitAreaCallback,
    },
  );
  createRotateGroupHandle('handle_rotate_nw', 'nw');
  createRotateGroupHandle('handle_rotate_ne', 'ne');
  createRotateGroupHandle('handle_rotate_sw', 'sw');
  createRotateGroupHandle('handle_rotate_se', 'se');

  let groupTransformContext: {
    handleName: string;
    selectedIds: string[];
    startPointerX: number;
    startPointerY: number;
    frame: SelectionFrame;
    corner: TransformGizmoCorner | null;
    proportional: boolean;
    startObjects: Map<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>;
  } | null = null;
  let lockedStageCursor: string | null = null;

  const setLockedStageCursor = (cursor: string | null) => {
    lockedStageCursor = cursor;
    const canvas = scene.game.canvas as HTMLCanvasElement | undefined;
    if (!canvas) {
      return;
    }
    if (cursor) {
      canvas.style.cursor = cursor;
    } else {
      canvas.style.removeProperty('cursor');
    }
  };

  scene.input.on('pointermove', () => {
    if (!lockedStageCursor) {
      return;
    }
    const canvas = scene.game.canvas as HTMLCanvasElement | undefined;
    if (canvas && canvas.style.cursor !== lockedStageCursor) {
      canvas.style.cursor = lockedStageCursor;
    }
  });

  const getGroupCorner = (handleName: string): TransformGizmoCorner | null => {
    switch (handleName) {
      case 'handle_nw':
        return 'nw';
      case 'handle_ne':
        return 'ne';
      case 'handle_sw':
        return 'sw';
      case 'handle_se':
        return 'se';
      default:
        return null;
    }
  };

  const getGroupSide = (handleName: string): TransformGizmoSide | null => {
    switch (handleName) {
      case 'handle_n':
        return 'n';
      case 'handle_e':
        return 'e';
      case 'handle_s':
        return 's';
      case 'handle_w':
        return 'w';
      default:
        return null;
    }
  };

  const shouldUseProportionalStageScale = (
    selectedIds: string[],
    event?: MouseEvent | PointerEvent,
  ) => {
    if (event?.shiftKey) {
      return true;
    }
    return selectedIds.some((selectedId) => {
      const selectedContainer = scene.children.getByName(selectedId) as Phaser.GameObjects.Container | null;
      const objectData = selectedContainer?.getData('objectData') as GameObject | undefined;
      return objectData?.lockScaleProportions ?? true;
    });
  };

  const setGroupGizmoVisible = (visible: boolean) => {
    groupOverlayGraphics.setVisible(visible);
    if (!visible) {
      groupOverlayGraphics.clear();
    }
    groupHandles.forEach((handle) => handle.setVisible(visible));
  };

  const getSelectionBounds = (selectedIds: string[]) => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let foundAny = false;

    for (const selectedId of selectedIds) {
      const selectedContainer = scene.children.getByName(selectedId) as Phaser.GameObjects.Container | null;
      if (!selectedContainer) continue;
      const selectedHitRect = selectedContainer.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
      const bounds = selectedHitRect ? selectedHitRect.getBounds() : selectedContainer.getBounds();
      minX = Math.min(minX, bounds.left);
      minY = Math.min(minY, bounds.top);
      maxX = Math.max(maxX, bounds.right);
      maxY = Math.max(maxY, bounds.bottom);
      foundAny = true;
    }

    if (!foundAny) return null;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return {
      centerX: minX + width / 2,
      centerY: minY + height / 2,
      width,
      height,
    };
  };

  const getSingleSelectionGizmoFrame = (selectedId: string) => {
    const selectedContainer = scene.children.getByName(selectedId) as Phaser.GameObjects.Container | null;
    if (!selectedContainer) return null;

    const selectedHitRect = selectedContainer.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
    const localCenterX = selectedHitRect ? selectedHitRect.x : 0;
    const localCenterY = selectedHitRect ? selectedHitRect.y : 0;

    const worldMatrix = selectedContainer.getWorldTransformMatrix();
    const worldCenter = worldMatrix.transformPoint(localCenterX, localCenterY);

    const localWidth = selectedHitRect ? selectedHitRect.width : selectedContainer.width;
    const localHeight = selectedHitRect ? selectedHitRect.height : selectedContainer.height;
    const width = Math.max(1, localWidth * Math.abs(selectedContainer.scaleX));
    const height = Math.max(1, localHeight * Math.abs(selectedContainer.scaleY));

    return {
      centerX: worldCenter.x,
      centerY: worldCenter.y,
      width,
      height,
      rotation: selectedContainer.rotation,
    };
  };

  const getSelectionGizmoFrame = (selectedIds: string[]) => {
    if (selectedIds.length === 1) {
      return getSingleSelectionGizmoFrame(selectedIds[0]);
    }
    const bounds = getSelectionBounds(selectedIds);
    if (!bounds) return null;
    return {
      ...bounds,
      rotation: 0,
    };
  };

  const updateGroupGizmo = (frame: SelectionFrame) => {
    const cameraZoom = scene.cameras.main.zoom || 1;
    const uiScale = 1 / cameraZoom;
    const rotation = frame.rotation ?? 0;
    const frameGeometry = getTransformGizmoHandleFrame(
      { x: frame.centerX, y: frame.centerY },
      frame.width,
      frame.height,
      rotation,
    );
    const edgeSegments = getTransformGizmoEdgeSegments(frameGeometry);
    const palette = getStageGizmoPaletteForSelection(scene, selectedIdsCache);
    const guide: SelectionGuide | null = groupTransformContext?.proportional
      ? {
          proportional: true,
          corner: groupTransformContext.corner,
        }
      : null;

    groupOverlayGraphics.clear();
    groupOverlayGraphics.lineStyle(TRANSFORM_GIZMO_STROKE_WIDTH * uiScale, palette.phaserColor, 1);
    groupOverlayGraphics.fillStyle(palette.phaserColor, STAGE_SELECTION_FILL_ALPHA);
    groupOverlayGraphics.beginPath();
    groupOverlayGraphics.moveTo(frameGeometry.corners.nw.x, frameGeometry.corners.nw.y);
    groupOverlayGraphics.lineTo(frameGeometry.corners.ne.x, frameGeometry.corners.ne.y);
    groupOverlayGraphics.lineTo(frameGeometry.corners.se.x, frameGeometry.corners.se.y);
    groupOverlayGraphics.lineTo(frameGeometry.corners.sw.x, frameGeometry.corners.sw.y);
    groupOverlayGraphics.closePath();
    groupOverlayGraphics.fillPath();
    groupOverlayGraphics.strokePath();

    if (guide?.proportional) {
      const diagonal = guide.corner
        ? getTransformCornerDiagonal(frameGeometry.corners, guide.corner)
        : getTransformDiagonal(frameGeometry.corners, DEFAULT_TRANSFORM_GIZMO_PROPORTIONAL_DIAGONAL);
      if (diagonal) {
        groupOverlayGraphics.lineStyle(TRANSFORM_GIZMO_STROKE_WIDTH * uiScale, palette.phaserColor, 1);
        drawDashedWorldLine(
          groupOverlayGraphics,
          diagonal.start,
          diagonal.end,
          TRANSFORM_GIZMO_PROPORTIONAL_GUIDE_DASH[0] * uiScale,
          TRANSFORM_GIZMO_PROPORTIONAL_GUIDE_DASH[1] * uiScale,
        );
      }
    }

    const handleRadius = TRANSFORM_GIZMO_HANDLE_RADIUS * uiScale;
    groupOverlayGraphics.lineStyle(GIZMO_STROKE_PX * uiScale, palette.phaserColor, 1);
    groupOverlayGraphics.fillStyle(0xffffff, 1);
    for (const point of [
      frameGeometry.corners.nw,
      frameGeometry.corners.ne,
      frameGeometry.corners.sw,
      frameGeometry.corners.se,
    ]) {
      groupOverlayGraphics.fillCircle(point.x, point.y, handleRadius);
      groupOverlayGraphics.strokeCircle(point.x, point.y, handleRadius);
    }

    const setHandle = (name: string, x: number, y: number, corner?: TransformGizmoCorner) => {
      const handle = groupHandles.get(name);
      if (!handle) return;
      handle.setPosition(x, y);
      const isEdgeHandle = name === 'handle_n' || name === 'handle_e' || name === 'handle_s' || name === 'handle_w';
      if (isEdgeHandle && handle instanceof Phaser.GameObjects.Rectangle) {
        const isHorizontalEdge = name === 'handle_n' || name === 'handle_s';
        const cornerInsetWorld = GIZMO_EDGE_CORNER_PREFERENCE_INSET_PX / Math.max(cameraZoom, 0.0001);
        const displayWidth = isHorizontalEdge
          ? Math.max(1, frame.width - (cornerInsetWorld * 2))
          : GIZMO_EDGE_HIT_THICKNESS_PX / cameraZoom;
        const displayHeight = isHorizontalEdge
          ? GIZMO_EDGE_HIT_THICKNESS_PX / cameraZoom
          : Math.max(1, frame.height - (cornerInsetWorld * 2));
        handle.setSize(displayWidth, displayHeight);
        handle.setDisplaySize(displayWidth, displayHeight);
        handle.setRotation(rotation);
      } else {
        handle.setScale(uiScale, uiScale);
        handle.setRotation(0);
      }
      if (handle.input) {
        switch (name) {
          case 'handle_nw':
            handle.input.cursor = getTransformGizmoCornerCursor('nw', rotation);
            break;
          case 'handle_ne':
            handle.input.cursor = getTransformGizmoCornerCursor('ne', rotation);
            break;
          case 'handle_sw':
            handle.input.cursor = getTransformGizmoCornerCursor('sw', rotation);
            break;
          case 'handle_se':
            handle.input.cursor = getTransformGizmoCornerCursor('se', rotation);
            break;
          case 'handle_n':
          case 'handle_s':
            handle.input.cursor = getTransformGizmoEdgeCursor('vertical', rotation);
            break;
          case 'handle_e':
          case 'handle_w':
            handle.input.cursor = getTransformGizmoEdgeCursor('horizontal', rotation);
            break;
          default:
            if (corner) {
              handle.input.cursor = getTransformGizmoRotateCursor(rotation, corner);
            }
            break;
        }
      }
      if (corner) {
        handle.setData('frameRotation', rotation);
      }
    };

    setHandle('handle_nw', frameGeometry.corners.nw.x, frameGeometry.corners.nw.y);
    setHandle('handle_ne', frameGeometry.corners.ne.x, frameGeometry.corners.ne.y);
    setHandle('handle_sw', frameGeometry.corners.sw.x, frameGeometry.corners.sw.y);
    setHandle('handle_se', frameGeometry.corners.se.x, frameGeometry.corners.se.y);
    setHandle('handle_n', edgeSegments.n.center.x, edgeSegments.n.center.y);
    setHandle('handle_e', edgeSegments.e.center.x, edgeSegments.e.center.y);
    setHandle('handle_s', edgeSegments.s.center.x, edgeSegments.s.center.y);
    setHandle('handle_w', edgeSegments.w.center.x, edgeSegments.w.center.y);
    setHandle('handle_rotate_nw', frameGeometry.corners.nw.x, frameGeometry.corners.nw.y, 'nw');
    setHandle('handle_rotate_ne', frameGeometry.corners.ne.x, frameGeometry.corners.ne.y, 'ne');
    setHandle('handle_rotate_sw', frameGeometry.corners.sw.x, frameGeometry.corners.sw.y, 'sw');
    setHandle('handle_rotate_se', frameGeometry.corners.se.x, frameGeometry.corners.se.y, 'se');
  };

  const drawMarquee = (pointer: Phaser.Input.Pointer) => {
    const minX = Math.min(marqueeStartX, pointer.worldX);
    const minY = Math.min(marqueeStartY, pointer.worldY);
    const width = Math.abs(pointer.worldX - marqueeStartX);
    const height = Math.abs(pointer.worldY - marqueeStartY);
    marqueeGraphics.clear();
    marqueeGraphics.fillStyle(0x4a90d9, 0.12);
    marqueeGraphics.fillRect(minX, minY, width, height);
    marqueeGraphics.lineStyle(1, 0x4a90d9, 1);
    marqueeGraphics.strokeRect(minX, minY, width, height);
    marqueeGraphics.setVisible(true);
  };

  const endMarqueeSelection = (pointer: Phaser.Input.Pointer) => {
    marqueeGraphics.clear();
    marqueeGraphics.setVisible(false);

    const currentMode = stageViewportController.getMode();
    if (currentMode !== 'editor') {
      isMarqueeSelecting = false;
      marqueePointerId = null;
      return;
    }

    const pointerWorldX = pointer.worldX;
    const pointerWorldY = pointer.worldY;
    const minX = Math.min(marqueeStartX, pointerWorldX);
    const minY = Math.min(marqueeStartY, pointerWorldY);
    const maxX = Math.max(marqueeStartX, pointerWorldX);
    const maxY = Math.max(marqueeStartY, pointerWorldY);

    if (!marqueeHasMoved) {
      if (marqueeMode === 'replace') {
        useEditorStore.getState().clearSelection();
      }
      isMarqueeSelecting = false;
      marqueePointerId = null;
      return;
    }

    const hits = new Set<string>();
    scene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (!(child instanceof Phaser.GameObjects.Container) || !child.getData('objectData')) return;
      const objectHitRect = child.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
      const bounds = objectHitRect ? objectHitRect.getBounds() : child.getBounds();
      const intersects = bounds.right >= minX && bounds.left <= maxX && bounds.bottom >= minY && bounds.top <= maxY;
      if (intersects) {
        hits.add(child.name);
      }
    });

    const orderedSceneObjectIds = getOrderedSceneObjectIds();
    const orderedHitIds = orderedSceneObjectIds.filter((id) => hits.has(id));

    const storeState = useEditorStore.getState();
    const currentSelected = storeState.selectedObjectIds.length > 0
      ? storeState.selectedObjectIds
      : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
    let nextSelection: string[] = orderedHitIds;

    if (marqueeMode === 'add') {
      nextSelection = Array.from(new Set([...currentSelected, ...orderedHitIds]));
    } else if (marqueeMode === 'toggle') {
      const toggled = new Set(currentSelected);
      for (const id of orderedHitIds) {
        if (toggled.has(id)) {
          toggled.delete(id);
        } else {
          toggled.add(id);
        }
      }
      nextSelection = orderedSceneObjectIds.filter((id) => toggled.has(id));
    }

    selectObjects(nextSelection, nextSelection[0] ?? null);
    isMarqueeSelecting = false;
    marqueePointerId = null;
  };

  const isPointerOverVisibleGizmo = (worldX: number, worldY: number): boolean => {
    for (const handle of groupHandles.values()) {
      if (handle.visible && handle.getBounds().contains(worldX, worldY)) {
        return true;
      }
    }

    const { selectedObjectId: activeId, selectedObjectIds: activeIds } = useEditorStore.getState();
    const selectedIds = activeIds.length > 0
      ? activeIds
      : (activeId ? [activeId] : []);
    for (const objectId of selectedIds) {
      const container = scene.children.getByName(objectId) as Phaser.GameObjects.Container | null;
      if (!container) continue;
      for (const name of GIZMO_HANDLE_NAMES) {
        const handle = container.getByName(name) as Phaser.GameObjects.Shape | Phaser.GameObjects.Arc | null;
        if (handle && handle.visible && handle.getBounds().contains(worldX, worldY)) {
          return true;
        }
      }
    }
    return false;
  };

  for (const [handleName, handle] of groupHandles.entries()) {
    handle.on('dragstart', (pointer: Phaser.Input.Pointer) => {
      const storeState = useEditorStore.getState();
      const selectedIds = storeState.selectedObjectIds.length > 0
        ? storeState.selectedObjectIds
        : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
      if (selectedIds.length === 0) {
        groupTransformContext = null;
        return;
      }

      const frame = getSelectionGizmoFrame(selectedIds);
      if (!frame) {
        groupTransformContext = null;
        return;
      }

      const startObjects = new Map<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>();
      for (const id of selectedIds) {
        const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        if (selectedContainer) {
          startObjects.set(id, {
            x: selectedContainer.x,
            y: selectedContainer.y,
            scaleX: selectedContainer.scaleX,
            scaleY: selectedContainer.scaleY,
            rotation: selectedContainer.rotation,
          });
        }
      }

      groupTransformContext = {
        handleName,
        selectedIds,
        startPointerX: pointer.worldX,
        startPointerY: pointer.worldY,
        frame,
        corner: getGroupCorner(handleName),
        proportional: shouldUseProportionalStageScale(selectedIds, pointer.event as MouseEvent | PointerEvent | undefined),
        startObjects,
      };
      setLockedStageCursor(handleName.startsWith('handle_rotate_') && groupTransformContext.corner
        ? getTransformGizmoRotateCursor(frame.rotation ?? 0, groupTransformContext.corner)
        : null);
    });

    handle.on('drag', (pointer: Phaser.Input.Pointer) => {
      if (!groupTransformContext || groupTransformContext.handleName !== handleName) return;

      const { frame, corner, startObjects, startPointerX, startPointerY } = groupTransformContext;
      const pointerEvent = pointer.event as MouseEvent | PointerEvent | undefined;
      if (handleName.startsWith('handle_rotate_')) {
        const angleToStart = Math.atan2(startPointerY - frame.centerY, startPointerX - frame.centerX);
        const angleToCurrent = Math.atan2(pointer.worldY - frame.centerY, pointer.worldX - frame.centerX);
        const deltaRotation = angleToCurrent - angleToStart;

        for (const [id, start] of startObjects) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (!selectedContainer) continue;

          const relX = start.x - frame.centerX;
          const relY = start.y - frame.centerY;
          const cos = Math.cos(deltaRotation);
          const sin = Math.sin(deltaRotation);
          selectedContainer.x = frame.centerX + relX * cos - relY * sin;
          selectedContainer.y = frame.centerY + relX * sin + relY * cos;
          selectedContainer.rotation = start.rotation + deltaRotation;
        }
        const canvas = scene.game.canvas as HTMLCanvasElement | undefined;
        if (canvas && corner) {
          canvas.style.cursor = getTransformGizmoRotateCursor((frame.rotation ?? 0) + deltaRotation, corner);
        }
      } else if (corner) {
        const rotation = frame.rotation ?? 0;
        const localRotation = -rotation;
        const frameGeometry = getTransformGizmoHandleFrame(
          { x: frame.centerX, y: frame.centerY },
          frame.width,
          frame.height,
          rotation,
        );
        const centered = !!pointerEvent?.altKey;
        const proportional = shouldUseProportionalStageScale(groupTransformContext.selectedIds, pointerEvent);
        groupTransformContext.proportional = proportional;
        const cornerConfig: Record<TransformGizmoCorner, {
          anchor: { x: number; y: number };
          handleXSign: -1 | 1;
          handleYSign: -1 | 1;
        }> = {
          nw: { anchor: frameGeometry.corners.se, handleXSign: -1, handleYSign: -1 },
          ne: { anchor: frameGeometry.corners.sw, handleXSign: 1, handleYSign: -1 },
          se: { anchor: frameGeometry.corners.nw, handleXSign: 1, handleYSign: 1 },
          sw: { anchor: frameGeometry.corners.ne, handleXSign: -1, handleYSign: 1 },
        };
        const resolvedCorner = cornerConfig[corner];
        const scaled = computeCornerScaleResult({
          referencePoint: centered ? { x: frame.centerX, y: frame.centerY } : resolvedCorner.anchor,
          pointerPoint: { x: pointer.worldX, y: pointer.worldY },
          handleXSign: resolvedCorner.handleXSign,
          handleYSign: resolvedCorner.handleYSign,
          rotationRadians: localRotation,
          baseWidth: Math.max(1, frame.width),
          baseHeight: Math.max(1, frame.height),
          minWidth: 8 / Math.max(scene.cameras.main.zoom || 1, 0.0001),
          minHeight: 8 / Math.max(scene.cameras.main.zoom || 1, 0.0001),
          proportional,
          centered,
        });
        const sx = scaled.signedWidth / Math.max(1, frame.width);
        const sy = scaled.signedHeight / Math.max(1, frame.height);
        const referencePoint = centered ? { x: frame.centerX, y: frame.centerY } : resolvedCorner.anchor;

        for (const [id, start] of startObjects) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (!selectedContainer) continue;

          const localStart = rotateTransformPoint(
            { x: start.x - referencePoint.x, y: start.y - referencePoint.y },
            localRotation,
          );
          const scaledLocal = {
            x: localStart.x * sx,
            y: localStart.y * sy,
          };
          const nextCenter = rotateTransformPoint(scaledLocal, -localRotation);
          selectedContainer.x = referencePoint.x + nextCenter.x;
          selectedContainer.y = referencePoint.y + nextCenter.y;
          selectedContainer.setScale(start.scaleX * sx, start.scaleY * sy);
        }
      } else {
        const side = getGroupSide(handleName);
        if (!side) {
          return;
        }
        const rotation = frame.rotation ?? 0;
        const localRotation = -rotation;
        const frameGeometry = getTransformGizmoHandleFrame(
          { x: frame.centerX, y: frame.centerY },
          frame.width,
          frame.height,
          rotation,
        );
        const edgeSegments = getTransformGizmoEdgeSegments(frameGeometry);
        const resolvedEdge = edgeSegments[side];
        const centered = !!pointerEvent?.altKey;
        const proportional = shouldUseProportionalStageScale(groupTransformContext.selectedIds, pointerEvent);
        groupTransformContext.proportional = proportional;
        const referencePoint = centered
          ? { x: frame.centerX, y: frame.centerY }
          : edgeSegments[getOppositeTransformGizmoSide(side)].center;
        const scaled = computeEdgeScaleResult({
          referencePoint,
          pointerPoint: { x: pointer.worldX, y: pointer.worldY },
          edge: resolvedEdge.edge,
          handleSign: resolvedEdge.handleSign,
          rotationRadians: localRotation,
          baseWidth: Math.max(1, frame.width),
          baseHeight: Math.max(1, frame.height),
          minWidth: 8 / Math.max(scene.cameras.main.zoom || 1, 0.0001),
          minHeight: 8 / Math.max(scene.cameras.main.zoom || 1, 0.0001),
          proportional,
          centered,
        });
        const sx = scaled.signedWidth / Math.max(1, frame.width);
        const sy = scaled.signedHeight / Math.max(1, frame.height);

        for (const [id, start] of startObjects) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (!selectedContainer) continue;

          const localStart = rotateTransformPoint(
            { x: start.x - referencePoint.x, y: start.y - referencePoint.y },
            localRotation,
          );
          const scaledLocal = {
            x: localStart.x * sx,
            y: localStart.y * sy,
          };
          const nextCenter = rotateTransformPoint(scaledLocal, -localRotation);
          selectedContainer.x = referencePoint.x + nextCenter.x;
          selectedContainer.y = referencePoint.y + nextCenter.y;
          selectedContainer.setScale(start.scaleX * sx, start.scaleY * sy);
        }
      }

      const updatedFrame = getSelectionGizmoFrame(groupTransformContext.selectedIds);
      if (updatedFrame) {
        updateGroupGizmo(updatedFrame);
      }
    });

    handle.on('dragend', () => {
      if (!groupTransformContext || groupTransformContext.handleName !== handleName) return;
      const currentTransformContext = groupTransformContext;
      runInHistoryTransaction('stage:transform-selection', () => {
        for (const id of currentTransformContext.selectedIds) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (!selectedContainer) continue;
          const rotationDeg = Phaser.Math.RadToDeg(selectedContainer.rotation);
          onDragEnd(id, selectedContainer.x, selectedContainer.y, selectedContainer.scaleX, selectedContainer.scaleY, rotationDeg);
        }
      });
      groupTransformContext = null;
      setLockedStageCursor(null);
    });
  }

  const beginTranslateDrag = (pointer: Phaser.Input.Pointer, objectId: string) => {
    const storeState = useEditorStore.getState();
    const selectedIds = storeState.selectedObjectIds.length > 0
      ? storeState.selectedObjectIds
      : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
    const orderedSceneObjectIds = getOrderedSceneObjectIds();
    const dragIds = (selectedIds.length > 1 && selectedIds.includes(objectId))
      ? orderedSceneObjectIds.filter((id) => selectedIds.includes(id))
      : [objectId];
    const startPositions = new Map<string, { x: number; y: number }>();
    for (const id of dragIds) {
      const draggedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
      if (draggedContainer) {
        startPositions.set(id, { x: draggedContainer.x, y: draggedContainer.y });
      }
    }

    if (startPositions.size === 0) {
      activeTranslateDrag = null;
      return;
    }

    activeTranslateDrag = {
      pointerId: pointer.id,
      objectIds: dragIds,
      startWorldX: pointer.worldX,
      startWorldY: pointer.worldY,
      startPositions,
      hasMoved: false,
    };
  };

  const endTranslateDrag = (pointer: Phaser.Input.Pointer) => {
    if (!activeTranslateDrag || activeTranslateDrag.pointerId !== pointer.id) return;

    if (activeTranslateDrag.hasMoved) {
      const currentTranslateDrag = activeTranslateDrag;
      runInHistoryTransaction('stage:translate-selection', () => {
        for (const id of currentTranslateDrag.objectIds) {
          const draggedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (draggedContainer) {
            onDragEnd(id, draggedContainer.x, draggedContainer.y);
          }
        }
      });
    }

    activeTranslateDrag = null;
  };

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.leftButtonDown()) return;

    const worldX = pointer.worldX;
    const worldY = pointer.worldY;

    if (isPointerOverVisibleGizmo(worldX, worldY)) {
      return;
    }

    const pickedObjectId = pickTopObjectIdAtWorldPoint(scene, worldX, worldY);
    if (pickedObjectId) {
      onObjectPointerDown(pointer, pickedObjectId);
      const event = pointer.event as MouseEvent | PointerEvent | undefined;
      const hasSelectionModifier = !!(event?.metaKey || event?.ctrlKey || event?.shiftKey);
      if (!hasSelectionModifier) {
        beginTranslateDrag(pointer, pickedObjectId);
      }
      return;
    }

    const currentMode = stageViewportController.getMode();
    if (currentMode !== 'editor') {
      const event = pointer.event as MouseEvent | PointerEvent | undefined;
      if (!(event?.metaKey || event?.ctrlKey || event?.shiftKey)) {
        useEditorStore.getState().clearSelection();
      }
      return;
    }

    const event = pointer.event as MouseEvent | PointerEvent | undefined;
    marqueeMode = event && (event.metaKey || event.ctrlKey)
      ? 'toggle'
      : (event?.shiftKey ? 'add' : 'replace');
    marqueeStartX = worldX;
    marqueeStartY = worldY;
    marqueeHasMoved = false;
    marqueePointerId = pointer.id;
    isMarqueeSelecting = true;
  });

  // Create objects (reverse depth so top of list = top render)
  const orderedSceneObjects = getSceneObjectsInLayerOrder(sceneData);
  const objectCount = orderedSceneObjects.length;
  const initialSelectedIds = new Set(
    selectedObjectIds.length > 0
      ? selectedObjectIds
      : (selectedObjectId ? [selectedObjectId] : []),
  );
  orderedSceneObjects.forEach((obj: GameObject, index: number) => {
    const container = createObjectVisual(scene, obj, true, canvasWidth, canvasHeight, components); // true = editor mode
    container.setDepth(objectCount - index); // Top of list = highest depth = renders on top
    const isSelected = initialSelectedIds.has(obj.id);
    container.setData('selected', isSelected);

    // Set initial selection and gizmo visibility
    const setSelectionVisible = (visible: boolean) => {
      const selRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
      if (selRect) selRect.setVisible(visible);

      // Per-object gizmo handles are disabled in favor of the global selection gizmo.
      for (const name of [...GIZMO_HANDLE_NAMES, 'rotate_line']) {
        const handle = container.getByName(name);
        if (handle) (handle as Phaser.GameObjects.Shape | Phaser.GameObjects.Graphics).setVisible(false);
      }
    };
    setSelectionVisible(false);
    container.setData('setSelectionVisible', setSelectionVisible);

    let dragContext: {
      pointerId: number;
      leaderStartX: number;
      leaderStartY: number;
      objectIds: string[];
      startPositions: Map<string, { x: number; y: number }>;
    } | null = null;

    container.on('dragstart', (pointer: Phaser.Input.Pointer) => {
      const storeState = useEditorStore.getState();
      const selectedIds = storeState.selectedObjectIds.length > 0
        ? storeState.selectedObjectIds
        : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
      const orderedSceneObjectIds = getOrderedSceneObjectIds();
      const dragIds = (selectedIds.length > 1 && selectedIds.includes(obj.id))
        ? orderedSceneObjectIds.filter((id) => selectedIds.includes(id))
        : [obj.id];
      const startPositions = new Map<string, { x: number; y: number }>();
      for (const id of dragIds) {
        const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        if (selectedContainer) {
          startPositions.set(id, { x: selectedContainer.x, y: selectedContainer.y });
        }
      }
      dragContext = {
        pointerId: pointer.id,
        leaderStartX: container.x,
        leaderStartY: container.y,
        objectIds: dragIds,
        startPositions,
      };
    });

    container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (dragContext) {
        const dx = dragX - dragContext.leaderStartX;
        const dy = dragY - dragContext.leaderStartY;
        for (const id of dragContext.objectIds) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          const startPos = dragContext.startPositions.get(id);
          if (selectedContainer && startPos) {
            selectedContainer.x = startPos.x + dx;
            selectedContainer.y = startPos.y + dy;
          }
        }
        return;
      }
      container.x = dragX;
      container.y = dragY;
    });

    container.on('dragend', () => {
      if (dragContext) {
        const currentDragContext = dragContext;
        runInHistoryTransaction('stage:drag-selection', () => {
          for (const id of currentDragContext.objectIds) {
            const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
            if (selectedContainer) {
              onDragEnd(id, selectedContainer.x, selectedContainer.y);
            }
          }
        });
        dragContext = null;
        return;
      }
      runInHistoryTransaction('stage:drag-object', () => {
        onDragEnd(obj.id, container.x, container.y);
      });
    });

  });

  // Update selection visuals on scene update
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (activeTranslateDrag && activeTranslateDrag.pointerId === pointer.id) {
      const dx = pointer.worldX - activeTranslateDrag.startWorldX;
      const dy = pointer.worldY - activeTranslateDrag.startWorldY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        activeTranslateDrag.hasMoved = true;
      }
      for (const id of activeTranslateDrag.objectIds) {
        const draggedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        const startPos = activeTranslateDrag.startPositions.get(id);
        if (draggedContainer && startPos) {
          draggedContainer.x = startPos.x + dx;
          draggedContainer.y = startPos.y + dy;
        }
      }
      return;
    }

    if (!isMarqueeSelecting || marqueePointerId !== pointer.id) return;
    const dx = Math.abs(pointer.worldX - marqueeStartX);
    const dy = Math.abs(pointer.worldY - marqueeStartY);
    if (dx > 2 || dy > 2) {
      marqueeHasMoved = true;
      drawMarquee(pointer);
    }
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    setLockedStageCursor(null);
    endTranslateDrag(pointer);
    if (isMarqueeSelecting && marqueePointerId === pointer.id) {
      endMarqueeSelection(pointer);
    }
  });

  let selectionStamp = '';
  let selectedIdsCache: string[] = [];

  const applySelectionVisuals = (selectedIds: string[]) => {
    const selectedSet = new Set(selectedIds);

    scene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (!(child instanceof Phaser.GameObjects.Container) || !child.getData('objectData')) return;
      const isSelected = selectedSet.has(child.name);
      child.setData('selected', isSelected);
      const setSelectionVisible = child.getData('setSelectionVisible') as ((visible: boolean) => void) | undefined;
      if (setSelectionVisible) {
        setSelectionVisible(false);
      } else {
        // Fallback for containers without the helper.
        const selectionRect = child.getByName('selection') as Phaser.GameObjects.Rectangle | null;
        if (selectionRect) {
          selectionRect.setVisible(false);
        }
      }
    });
  };

  scene.events.on('update', () => {
    updateTiledBackgroundLayer(scene, tiledBackgroundLayer);

    const storeState = useEditorStore.getState();
    const selectedIds = storeState.selectedObjectIds.length > 0
      ? storeState.selectedObjectIds
      : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
    const nextSelectionStamp = selectedIds.join('|');
    if (nextSelectionStamp !== selectionStamp) {
      selectionStamp = nextSelectionStamp;
      selectedIdsCache = [...selectedIds];
      applySelectionVisuals(selectedIdsCache);
    }

    if (selectedIdsCache.length === 0) {
      setGroupGizmoVisible(false);
      return;
    }

    if (!groupTransformContext) {
      const selectionFrame = getSelectionGizmoFrame(selectedIdsCache);
      if (!selectionFrame) {
        setGroupGizmoVisible(false);
        return;
      }
      updateGroupGizmo(selectionFrame);
    }

    setGroupGizmoVisible(true);
  });
}

/**
 * Create a Phaser scene config for dynamic scene addition
 */
function createPlaySceneConfig(
  sceneData: SceneData,
  allScenes: SceneData[],
  components: ComponentDefinition[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  canvasWidth: number,
  canvasHeight: number,
  globalVariables: Variable[],
  allObjects: GameObject[],
  sceneId: string,
  onRuntimeReady: (runtime: RuntimeEngine) => void,
): Phaser.Types.Scenes.CreateSceneFromObjectConfig {
  return {
    create: function(this: Phaser.Scene) {
      createPlaySceneContent(
        this,
        sceneData,
        allScenes,
        components,
        runtimeRef,
        canvasWidth,
        canvasHeight,
        globalVariables,
        allObjects,
        sceneId,
        onRuntimeReady,
      );
    },
    update: function(this: Phaser.Scene) {
      const tiledBackgroundLayer = this.data.get('tiledBackgroundLayer') as TiledBackgroundLayerState | undefined;
      if (tiledBackgroundLayer) {
        updateTiledBackgroundLayer(this, tiledBackgroundLayer);
      }

      const runtime = sceneRuntimes.get(sceneId);
      if (runtime && !runtime.isPaused()) {
        runtime.update();

        // Check for scene switch from this scene's runtime
        const pendingSwitch = runtime.pendingSceneSwitch;
        if (pendingSwitch) {
          const targetSceneData = resolveSceneByReference(allScenes, pendingSwitch.sceneRef);
          if (targetSceneData) {
            runtime.clearPendingSceneSwitch();
            const currentSceneKey = `PlayScene_${sceneId}`;
            const targetSceneKey = `PlayScene_${targetSceneData.id}`;

            // Pause current runtime
            runtime.pause();

            // Check if target scene already exists
            const existingRuntime = sceneRuntimes.get(targetSceneData.id);

            if (existingRuntime && !pendingSwitch.restart) {
              // Resume existing scene
              this.scene.sleep(currentSceneKey);
              this.scene.wake(targetSceneKey);
              runtimeRef.current = existingRuntime;
              existingRuntime.resume();
              setCurrentRuntime(existingRuntime);
              onRuntimeReady(existingRuntime);
            } else {
              // Clean up and restart if needed
              if (existingRuntime) {
                existingRuntime.cleanup();
                sceneRuntimes.delete(targetSceneData.id);
                this.scene.stop(targetSceneKey);
              }

              this.scene.sleep(currentSceneKey);

              if (!this.scene.get(targetSceneKey)) {
                this.scene.add(targetSceneKey, createPlaySceneConfig(
                  targetSceneData,
                  allScenes,
                  components,
                  runtimeRef,
                  canvasWidth,
                  canvasHeight,
                  globalVariables,
                  allObjects,
                  targetSceneData.id,
                  onRuntimeReady,
                ), true);
              } else {
                this.scene.start(targetSceneKey);
              }
            }
          }
        }
      }
    },
  };
}

/**
 * Create the play scene content (running game mode)
 */
function createPlaySceneContent(
  scene: Phaser.Scene,
  sceneData: SceneData,
  _allScenes: SceneData[],
  components: ComponentDefinition[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  canvasWidth: number,
  canvasHeight: number,
  globalVariables: Variable[],
  allObjects: GameObject[],
  sceneId: string,
  onRuntimeReady: (runtime: RuntimeEngine) => void,
) {
  // Set background
  const bgColorValue = getSceneBackgroundBaseColor(sceneData.background);
  scene.cameras.main.setBackgroundColor(bgColorValue);

  const tiledBackgroundLayer = createTiledBackgroundLayerState(
    scene,
    sceneData.background ?? null,
    canvasWidth,
    canvasHeight,
  );
  updateTiledBackgroundLayer(scene, tiledBackgroundLayer);
  scene.data.set('tiledBackgroundLayer', tiledBackgroundLayer);
  scene.events.once('shutdown', () => {
    destroyTiledBackgroundLayer(scene, tiledBackgroundLayer);
  });

  // Create runtime engine with canvas dimensions for coordinate conversion
  const runtime = new RuntimeEngine(scene, canvasWidth, canvasHeight);
  runtimeRef.current = runtime;
  setCurrentRuntime(runtime);
  onRuntimeReady(runtime);

  // Store runtime for this scene (for pause/resume)
  sceneRuntimes.set(sceneId, runtime);

  const { byId: variableDefinitionsById, conflicts: variableDefinitionConflicts } = buildVariableDefinitionIndex(
    globalVariables,
    components,
    allObjects,
  );
  if (variableDefinitionConflicts.length > 0) {
    console.warn(
      `[PhaserCanvas] Detected ${variableDefinitionConflicts.length} variable ID conflict(s). Using first definition for each ID.`,
      variableDefinitionConflicts.slice(0, 5),
    );
  }

  // Set up variable lookup for typed variables
  runtime.setVariableLookup((varId: string) => variableDefinitionsById.get(varId));

  // Configure ground from scene settings
  if (sceneData.ground) {
    runtime.configureGround(
      sceneData.ground.enabled,
      sceneData.ground.y,
      sceneData.ground.color
    );
  }

  runtime.configureWorldBoundary(
    !!sceneData.worldBoundary?.enabled,
    sceneData.worldBoundary?.points || [],
  );

  // Register component templates so they can be spawned even if no instance exists in scene.
  for (const component of components) {
    const registerHandlers = compileBlocklyRegisterFunction(component.blocklyXml, component.id);
    runtime.registerComponentTemplate(
      component.id,
      {
        name: component.name,
        costumes: component.costumes || [],
        currentCostumeIndex: component.currentCostumeIndex || 0,
        physicsConfig: component.physics || null,
        colliderConfig: component.collider || null,
        sounds: component.sounds || [],
      },
      registerHandlers,
    );
  }

  // Create objects and register them with runtime (reverse depth so top of list = top render)
  const orderedSceneObjects = getSceneObjectsInLayerOrder(sceneData);
  const objectCount = orderedSceneObjects.length;
  orderedSceneObjects.forEach((obj: GameObject, index: number) => {
    // Get effective properties (resolves component references)
    const effectiveProps = getEffectiveObjectProps(obj, components);

    const container = createObjectVisual(scene, obj, false, canvasWidth, canvasHeight, components);
    container.setDepth(objectCount - index);

    // Register with runtime
    const runtimeSprite = runtime.registerSprite(obj.id, obj.name, container, obj.componentId);

    // Set costumes if available
    const costumes = effectiveProps.costumes || [];
    if (costumes.length > 0) {
      runtimeSprite.setCostumes(costumes, effectiveProps.currentCostumeIndex || 0);
    }

    // Register sounds with runtime
    const sounds = effectiveProps.sounds || [];
    if (sounds.length > 0) {
      runtime.registerSounds(sounds);
    }

    // Store collider and physics config
    const physics = effectiveProps.physics;
    const collider = effectiveProps.collider;
    runtimeSprite.setColliderConfig(collider || null);
    runtimeSprite.setPhysicsConfig(physics || null);

    if (physics?.enabled) {
      // Get default size from costume bounds
      const costume = costumes[effectiveProps.currentCostumeIndex || 0];
      let defaultWidth = 64, defaultHeight = 64;
      if (costume?.bounds && costume.bounds.width > 0 && costume.bounds.height > 0) {
        defaultWidth = costume.bounds.width;
        defaultHeight = costume.bounds.height;
      }

      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;
      const scaledDefaultWidth = defaultWidth * Math.abs(scaleX);
      const scaledDefaultHeight = defaultHeight * Math.abs(scaleY);

      const bodyOptions: Phaser.Types.Physics.Matter.MatterBodyConfig = {
        restitution: physics.bounce ?? 0,
        frictionAir: 0.01,
        friction: physics.friction ?? 0.1,
        collisionFilter: {
          mask: runtime.getPhysicsCollisionMaskForSprite(obj.id),
        },
      };

      let body: MatterJS.BodyType;
      const posX = container.x;
      const posY = container.y;

      const colliderOffsetX = (collider?.offsetX ?? 0) * scaleX;
      const colliderOffsetY = (collider?.offsetY ?? 0) * scaleY;
      const bodyX = posX + colliderOffsetX;
      const bodyY = posY + colliderOffsetY;

      const colliderType = collider?.type ?? 'circle';

      switch (colliderType) {
        case 'none': {
          body = scene.matter.add.rectangle(bodyX, bodyY, scaledDefaultWidth, scaledDefaultHeight, { ...bodyOptions, isSensor: true });
          break;
        }
        case 'circle': {
          const avgScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
          const baseRadius = collider?.radius || Math.max(defaultWidth, defaultHeight) / 2;
          const radius = baseRadius * avgScale;
          body = scene.matter.add.circle(bodyX, bodyY, radius, bodyOptions);
          break;
        }
        case 'capsule': {
          const baseWidth = collider?.width || defaultWidth;
          const baseHeight = collider?.height || defaultHeight;
          const width = baseWidth * Math.abs(scaleX);
          const height = baseHeight * Math.abs(scaleY);
          const chamferRadius = Math.min(width, height) / 2;
          body = scene.matter.add.rectangle(bodyX, bodyY, width, height, {
            ...bodyOptions,
            chamfer: { radius: chamferRadius },
          });
          break;
        }
        case 'box':
        default: {
          const baseWidth = collider?.width || defaultWidth;
          const baseHeight = collider?.height || defaultHeight;
          const width = baseWidth * Math.abs(scaleX);
          const height = baseHeight * Math.abs(scaleY);
          body = scene.matter.add.rectangle(bodyX, bodyY, width, height, bodyOptions);
          break;
        }
      }

      const existingBody = (container as unknown as { body?: MatterJS.BodyType }).body;
      if (existingBody) {
        scene.matter.world.remove(existingBody);
      }

      (body as MatterJS.BodyType & { destroy?: () => void }).destroy = () => {
        if (scene.matter?.world) {
          scene.matter.world.remove(body);
        }
      };

      (container as unknown as { body: MatterJS.BodyType }).body = body;

      container.setData('colliderOffsetX', colliderOffsetX);
      container.setData('colliderOffsetY', colliderOffsetY);

      scene.matter.world.on('afterupdate', () => {
        if (body && container.active && !body.isStatic) {
          const offsetX = container.getData('colliderOffsetX') ?? 0;
          const offsetY = container.getData('colliderOffsetY') ?? 0;
          container.setPosition(body.position.x - offsetX, body.position.y - offsetY);
          if (physics.allowRotation) {
            container.setRotation(body.angle);
          }
        }
      });

      container.setData('allowRotation', physics.allowRotation ?? false);

      scene.matter.body.setVelocity(body, {
        x: physics.velocityX ?? 0,
        y: -(physics.velocityY ?? 0)
      });

      if (physics.bodyType === 'static') {
        scene.matter.body.setVelocity(body, { x: 0, y: 0 });
        scene.matter.body.setAngularVelocity(body, 0);
        scene.matter.body.setStatic(body, true);
      }

      if (!physics.allowRotation) {
        scene.matter.body.setInertia(body, Infinity);
      }

      const gravityValue = physics.gravityY ?? 1;
      setBodyGravityY(body, gravityValue);
    }

    // Save template for cloning
    runtime.saveTemplate(obj.id);

    // Generate and execute code for this object
    const registerHandlers = compileBlocklyRegisterFunction(effectiveProps.blocklyXml, obj.id);
    if (registerHandlers) {
      try {
        registerHandlers(runtime, obj.id, runtimeSprite);
      } catch (e) {
        console.error('Error executing code for object', obj.name, e);
      }
    }
  });

  // Set up physics colliders
  runtime.setupPhysicsColliders();

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.leftButtonDown()) {
      return;
    }
    runtime.queueWorldClick(pointer.worldX, pointer.worldY);
  });

  // Start the runtime
  runtime.start();
}

function compileBlocklyRegisterFunction(
  blocklyXml: string,
  sourceId: string
): ((runtime: RuntimeEngine, spriteId: string, sprite: unknown) => void) | null {
  if (!blocklyXml) return null;
  const code = generateCodeForObject(blocklyXml, sourceId);
  if (!code) return null;

  try {
    const functionBody = `return ${code};`;
    const execFunction = new Function('runtime', 'spriteId', 'sprite', functionBody);
    const registerFunc = execFunction(undefined, sourceId, undefined);
    if (typeof registerFunc === 'function') {
      return registerFunc as (runtime: RuntimeEngine, spriteId: string, sprite: unknown) => void;
    }
  } catch (e) {
    console.error('Error compiling blockly code for', sourceId, e);
  }

  return null;
}

/**
 * Create the play scene (running game mode) - wrapper for initial scene
 */
function createPlayScene(
  scene: Phaser.Scene,
  sceneData: SceneData | undefined,
  allScenes: SceneData[],
  components: ComponentDefinition[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  canvasWidth: number,
  canvasHeight: number,
  globalVariables: Variable[],
  allObjects: GameObject[],
  sceneId?: string,
  onRuntimeReady: (runtime: RuntimeEngine) => void = () => {},
) {
  if (!sceneData) return;

  // Use provided sceneId or fallback to sceneData.id
  const effectiveSceneId = sceneId || sceneData.id;

  createPlaySceneContent(
    scene,
    sceneData,
    allScenes,
    components,
    runtimeRef,
    canvasWidth,
    canvasHeight,
    globalVariables,
    allObjects,
    effectiveSceneId,
    onRuntimeReady,
  );
}

/**
 * Create visual representation of a game object
 */
function createObjectVisual(
  scene: Phaser.Scene,
  obj: GameObject,
  isEditorMode: boolean = false,
  canvasWidth: number = 800,
  canvasHeight: number = 600,
  components: ComponentDefinition[] = []
): Phaser.GameObjects.Container {
  // Convert user coordinates to Phaser coordinates
  const phaserPos = userToPhaser(obj.x, obj.y, canvasWidth, canvasHeight);

  // Create container for the object
  const container = scene.add.container(phaserPos.x, phaserPos.y);
  container.setName(obj.id);
  container.setScale(obj.scaleX, obj.scaleY);
  container.setRotation(Phaser.Math.DegToRad(obj.rotation));
  container.setVisible(obj.visible);
  container.setData('objectData', obj);

  // Default size - will be updated when image loads
  const defaultSize = 64;
  container.setSize(defaultSize, defaultSize);

  // Create selection rectangle in editor mode (added first, sent to back)
  let selectionRect: Phaser.GameObjects.Rectangle | null = null;
  // Create invisible hit area rectangle for reliable click detection
  let hitRect: Phaser.GameObjects.Rectangle | null = null;
  if (isEditorMode) {
    // Selection visual
    const selectionPalette = getStageGizmoPaletteForObject(obj);
    selectionRect = scene.add.rectangle(0, 0, defaultSize + 8, defaultSize + 8);
    selectionRect.setStrokeStyle(GIZMO_STROKE_PX, selectionPalette.phaserColor);
    selectionRect.setFillStyle(selectionPalette.phaserColor, STAGE_SELECTION_FILL_ALPHA);
    selectionRect.setVisible(false);
    selectionRect.setName('selection');
    container.add(selectionRect);

    // Invisible hit area - this is what actually receives clicks
    hitRect = scene.add.rectangle(0, 0, defaultSize, defaultSize, 0x000000, 0);
    hitRect.setName('hitArea');
    hitRect.setInteractive({ useHandCursor: true });
    container.add(hitRect);
  }

  // Helper to update container size, hit area, and selection rect based on bounds
  const updateContainerWithBounds = (
    sprite: Phaser.GameObjects.Image,
    bounds: { x: number; y: number; width: number; height: number } | null | undefined,
    assetFrame?: CostumeAssetFrame | null,
  ) => {
    const metrics = getCostumeVisualMetrics({
      bounds,
      assetFrame,
      imageWidth: sprite.width,
      imageHeight: sprite.height,
    });
    sprite.setPosition(metrics.assetOffset.x, metrics.assetOffset.y);

    container.setSize(metrics.interactionWidth, metrics.interactionHeight);

    if (hitRect) {
      hitRect.setSize(metrics.interactionWidth, metrics.interactionHeight);
      hitRect.setPosition(metrics.interactionOffset.x, metrics.interactionOffset.y);
      hitRect.removeInteractive();
      hitRect.setInteractive({ useHandCursor: true });
    }

    if (selectionRect) {
      selectionRect.setSize(metrics.interactionWidth + 8, metrics.interactionHeight + 8);
      selectionRect.setPosition(metrics.interactionOffset.x, metrics.interactionOffset.y);
    }
  };

  // Get current costume (use effective props for component instances)
  const effectiveProps = getEffectiveObjectProps(obj, components);
  const costumes = effectiveProps.costumes || [];
  const currentCostumeIndex = effectiveProps.currentCostumeIndex ?? 0;
  const currentCostume = costumes[currentCostumeIndex];

  if (currentCostume && currentCostume.assetId) {
    const textureKey = getCostumeTextureKey(obj.id, currentCostume.id, currentCostume.assetId);

    // Store costume ID, assetId, textureKey, and bounds for change detection
    container.setData('costumeId', currentCostume.id);
    container.setData('assetId', currentCostume.assetId);
    container.setData('assetFrame', currentCostume.assetFrame ?? null);
    container.setData('textureKey', textureKey);
    container.setData('bounds', currentCostume.bounds);

    // Load texture from data URL
    void loadImageSource(currentCostume.assetId).then((img) => {
      if (!container.active || !container.scene) return;
      if (scene.textures.exists(textureKey)) return; // Avoid double-add
      scene.textures.addImage(textureKey, img);

      // Create sprite after texture is loaded
      const sprite = scene.add.image(0, 0, textureKey);
      sprite.setName('sprite');
      container.add(sprite);
      // Send selection to back, bring hit area to front for input
      if (selectionRect) container.sendToBack(selectionRect);
      if (hitRect) container.bringToTop(hitRect);
      updateContainerWithBounds(sprite, currentCostume.bounds, currentCostume.assetFrame);
    }).catch((error) => {
      console.warn('Failed to load costume texture source for stage sprite creation.', error);
    });
  } else {
    // No costume - create colored rectangle as placeholder
    const graphics = scene.add.graphics();
    graphics.setName('placeholder');
    const color = getObjectColor(obj.id);

    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(-32, -32, 64, 64, 8);
    graphics.lineStyle(2, 0x333333);
    graphics.strokeRoundedRect(-32, -32, 64, 64, 8);

    container.add(graphics);
    // Send selection to back, bring hit area to front for input
    if (selectionRect) container.sendToBack(selectionRect);
    if (hitRect) container.bringToTop(hitRect);
    // Ensure hit area is properly configured for placeholder
    if (hitRect) {
      hitRect.setSize(64, 64);
    }
    if (selectionRect) {
      selectionRect.setSize(72, 72);
    }
  }

  return container;
}

/**
 * Generate a consistent color from an ID
 */
function getObjectColor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash = hash & hash;
  }
  const hue = Math.abs(hash % 360);
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.7).color;
}
