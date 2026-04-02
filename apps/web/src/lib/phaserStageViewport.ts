import Phaser from 'phaser';
import {
  buildStageProjection,
  normalizeStageEditorViewport,
  type StageEditorViewport,
  type StageProjection,
  type StageSize,
  type StageViewMode,
} from '@/lib/stageViewport';

const STAGE_VIEWPORT_CONTROLLER_KEY = 'stageViewportController';
const STAGE_PROJECTION_KEY = 'stageProjection';
const STAGE_EDITOR_VIEWPORT_KEY = 'stageEditorViewport';
const STAGE_VIEW_MODE_KEY = 'viewMode';

export interface StageViewportController {
  getMode: () => StageViewMode;
  setMode: (mode: StageViewMode) => StageProjection;
  getEditorViewport: () => StageEditorViewport;
  setEditorViewport: (viewport: StageEditorViewport) => StageProjection;
  getProjection: () => StageProjection;
  syncProjection: () => StageProjection;
}

export interface CreateStageViewportControllerOptions {
  scene: Phaser.Scene;
  canvasSize: StageSize;
  initialMode: StageViewMode;
  initialEditorViewport?: StageEditorViewport | null;
  onEditorViewportChange?: (viewport: StageEditorViewport) => void;
}

function sanitizeHostSize(scene: Phaser.Scene): StageSize {
  return {
    width: Math.max(1, Math.round(scene.scale.width || 1)),
    height: Math.max(1, Math.round(scene.scale.height || 1)),
  };
}

function areEditorViewportsEqual(a: StageEditorViewport, b: StageEditorViewport): boolean {
  return a.centerX === b.centerX && a.centerY === b.centerY && a.zoom === b.zoom;
}

export function applyStageProjectionToCamera(
  camera: Phaser.Cameras.Scene2D.Camera,
  projection: StageProjection,
): void {
  camera.setViewport(
    projection.cameraViewport.x,
    projection.cameraViewport.y,
    projection.cameraViewport.width,
    projection.cameraViewport.height,
  );
  camera.setZoom(projection.cameraZoom);
  camera.scrollX = projection.scrollX;
  camera.scrollY = projection.scrollY;
  camera.preRender();
}

export function createStageViewportController(
  options: CreateStageViewportControllerOptions,
): StageViewportController {
  const { scene, canvasSize, onEditorViewportChange } = options;
  let mode = options.initialMode;
  let editorViewport = normalizeStageEditorViewport(options.initialEditorViewport, canvasSize);
  let projection = buildStageProjection({
    mode,
    hostSize: sanitizeHostSize(scene),
    canvasSize,
    editorViewport,
  });

  const syncProjection = () => {
    projection = buildStageProjection({
      mode,
      hostSize: sanitizeHostSize(scene),
      canvasSize,
      editorViewport,
    });
    scene.data.set(STAGE_VIEW_MODE_KEY, mode);
    scene.data.set(STAGE_EDITOR_VIEWPORT_KEY, editorViewport);
    scene.data.set(STAGE_PROJECTION_KEY, projection);
    applyStageProjectionToCamera(scene.cameras.main, projection);
    return projection;
  };

  const controller: StageViewportController = {
    getMode: () => mode,
    setMode: (nextMode) => {
      mode = nextMode;
      return syncProjection();
    },
    getEditorViewport: () => editorViewport,
    setEditorViewport: (nextViewport) => {
      const normalizedViewport = normalizeStageEditorViewport(nextViewport, canvasSize);
      if (!areEditorViewportsEqual(editorViewport, normalizedViewport)) {
        editorViewport = normalizedViewport;
        onEditorViewportChange?.(editorViewport);
      }
      return syncProjection();
    },
    getProjection: () => projection,
    syncProjection,
  };

  scene.data.set(STAGE_VIEWPORT_CONTROLLER_KEY, controller);
  scene.events.once('shutdown', () => {
    scene.data.remove(STAGE_VIEWPORT_CONTROLLER_KEY);
    scene.data.remove(STAGE_PROJECTION_KEY);
    scene.data.remove(STAGE_EDITOR_VIEWPORT_KEY);
  });

  syncProjection();
  return controller;
}

export function getStageViewportController(scene: Phaser.Scene): StageViewportController | null {
  const controller = scene.data.get(STAGE_VIEWPORT_CONTROLLER_KEY) as StageViewportController | undefined;
  return controller ?? null;
}
