import { expect, test } from '@playwright/test';
import {
  buildStageProjection,
  createDefaultStageEditorViewport,
  getStageEditorViewportWorldPoint,
  scrollStageEditorViewport,
  zoomStageEditorViewportAtScreenPoint,
} from '../src/lib/stageViewport';

test.describe('stage viewport projection', () => {
  test('preserves the editor world center when the host size changes', () => {
    const editorViewport = {
      centerX: 623.5,
      centerY: 412.25,
      zoom: 1.75,
    };

    const before = buildStageProjection({
      mode: 'editor',
      hostSize: { width: 920, height: 540 },
      canvasSize: { width: 800, height: 600 },
      editorViewport,
    });
    const after = buildStageProjection({
      mode: 'editor',
      hostSize: { width: 1320, height: 860 },
      canvasSize: { width: 800, height: 600 },
      editorViewport,
    });

    const beforeCenter = {
      x: before.scrollX + before.cameraViewport.width / 2,
      y: before.scrollY + before.cameraViewport.height / 2,
    };
    const afterCenter = {
      x: after.scrollX + after.cameraViewport.width / 2,
      y: after.scrollY + after.cameraViewport.height / 2,
    };

    expect(beforeCenter).toEqual({
      x: editorViewport.centerX,
      y: editorViewport.centerY,
    });
    expect(afterCenter).toEqual({
      x: editorViewport.centerX,
      y: editorViewport.centerY,
    });
  });

  test('camera viewport mode letterboxes around the stage', () => {
    const projection = buildStageProjection({
      mode: 'camera-viewport',
      hostSize: { width: 1280, height: 900 },
      canvasSize: { width: 800, height: 600 },
      editorViewport: createDefaultStageEditorViewport({ width: 800, height: 600 }),
    });

    expect(projection.cameraZoom).toBeCloseTo(1.5);
    expect(projection.cameraViewport).toEqual({
      x: 40,
      y: 0,
      width: 1200,
      height: 900,
    });
  });

  test('camera masked mode fills the host and crops instead of letterboxing', () => {
    const projection = buildStageProjection({
      mode: 'camera-masked',
      hostSize: { width: 1280, height: 900 },
      canvasSize: { width: 800, height: 600 },
      editorViewport: createDefaultStageEditorViewport({ width: 800, height: 600 }),
    });

    expect(projection.cameraViewport).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 900,
    });
    expect(projection.cameraZoom).toBeCloseTo(1.6);
  });

  test('wheel scrolling moves the editor viewport in screen-space direction', () => {
    const viewport = scrollStageEditorViewport(
      { centerX: 400, centerY: 300, zoom: 2 },
      120,
      -80,
    );

    expect(viewport).toEqual({
      centerX: 460,
      centerY: 260,
      zoom: 2,
    });
  });

  test('zooming at a screen point keeps that world point stable', () => {
    const initialViewport = {
      centerX: 510,
      centerY: 380,
      zoom: 1.25,
    };
    const hostSize = { width: 900, height: 700 };
    const pivot = { x: 220, y: 180 };
    const nextViewport = zoomStageEditorViewportAtScreenPoint(
      initialViewport,
      hostSize,
      pivot,
      2.5,
    );
    const worldBefore = getStageEditorViewportWorldPoint(initialViewport, hostSize, pivot);
    const worldAfter = getStageEditorViewportWorldPoint(nextViewport, hostSize, pivot);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8);
  });
});
