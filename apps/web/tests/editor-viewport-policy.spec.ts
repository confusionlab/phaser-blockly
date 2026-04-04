import { expect, test } from '@playwright/test';
import {
  computeEditorViewportFitResult,
  normalizeEditorViewportFitBounds,
} from '../src/lib/editor/editorViewportPolicy';

test.describe('editor viewport policy', () => {
  test('normalizes edge bounds regardless of axis orientation', () => {
    const normalized = normalizeEditorViewportFitBounds({
      left: 500,
      right: 100,
      top: -50,
      bottom: 250,
    });

    expect(normalized).toEqual({
      minX: 100,
      maxX: 500,
      minY: -50,
      maxY: 250,
      width: 400,
      height: 300,
      centerX: 300,
      centerY: 100,
    });
  });

  test('fits edge bounds into a viewport with shared padding', () => {
    const fit = computeEditorViewportFitResult({
      bounds: {
        left: 100,
        right: 500,
        top: 300,
        bottom: 100,
      },
      viewportSize: { width: 800, height: 600 },
      minZoom: 0.1,
      maxZoom: 10,
      paddingPx: 50,
    });

    expect(fit).not.toBeNull();
    expect(fit?.centerX).toBe(300);
    expect(fit?.centerY).toBe(200);
    expect(fit?.zoom).toBeCloseTo(1.75, 8);
  });

  test('supports zoom scales where zoom 1 is not one pixel per world unit', () => {
    const fit = computeEditorViewportFitResult({
      bounds: {
        left: 0,
        top: 0,
        width: 200,
        height: 100,
      },
      viewportSize: { width: 500, height: 300 },
      minZoom: 0.1,
      maxZoom: 10,
      paddingPx: 50,
      pixelsPerWorldUnitAtZoom1: 0.5,
    });

    expect(fit).not.toBeNull();
    expect(fit?.centerX).toBe(100);
    expect(fit?.centerY).toBe(50);
    expect(fit?.zoom).toBeCloseTo(4, 8);
  });

  test('clamps computed zoom to the provided limits', () => {
    const fit = computeEditorViewportFitResult({
      bounds: {
        left: 0,
        top: 0,
        width: 5000,
        height: 5000,
      },
      viewportSize: { width: 100, height: 100 },
      minZoom: 0.25,
      maxZoom: 2,
      paddingPx: 0,
    });

    expect(fit).not.toBeNull();
    expect(fit?.zoom).toBe(0.25);
  });
});
