import { expect, test } from '@playwright/test';
import { toggleScaleDirection } from '../src/phaser/scaleMath';
import {
  DEFAULT_TRANSFORM_GIZMO_PROPORTIONAL_DIAGONAL,
  computeCornerScaleResult,
  getTransformCornerDiagonal,
  getTransformGizmoCornerHitRadius,
  getTransformGizmoRotateRingRadii,
  hitTransformGizmoCornerTarget,
  resolveTransformProportionalGuideDiagonal,
} from '../src/lib/editor/unifiedTransformGizmo';

test.describe('scale math', () => {
  test('toggleScaleDirection preserves magnitude while flipping sign', () => {
    expect(toggleScaleDirection(1)).toBe(-1);
    expect(toggleScaleDirection(-1)).toBe(1);
    expect(toggleScaleDirection(1.25)).toBe(-1.25);
    expect(toggleScaleDirection(-1.25)).toBe(1.25);
  });

  test('computeCornerScaleResult allows free corner scaling by default', () => {
    const result = computeCornerScaleResult({
      referencePoint: { x: 0, y: 0 },
      pointerPoint: { x: 30, y: 20 },
      handleXSign: 1,
      handleYSign: 1,
      rotationRadians: 0,
      baseWidth: 10,
      baseHeight: 10,
      minWidth: 1,
      minHeight: 1,
      proportional: false,
      centered: false,
    });

    expect(result.width).toBe(30);
    expect(result.height).toBe(20);
    expect(result.center).toEqual({ x: 15, y: 10 });
  });

  test('computeCornerScaleResult locks aspect ratio when requested', () => {
    const result = computeCornerScaleResult({
      referencePoint: { x: 0, y: 0 },
      pointerPoint: { x: 30, y: 20 },
      handleXSign: 1,
      handleYSign: 1,
      rotationRadians: 0,
      baseWidth: 20,
      baseHeight: 10,
      minWidth: 1,
      minHeight: 1,
      proportional: true,
      centered: false,
    });

    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
    expect(result.center).toEqual({ x: 20, y: 10 });
  });

  test('computeCornerScaleResult can scale from the center', () => {
    const result = computeCornerScaleResult({
      referencePoint: { x: 100, y: 80 },
      pointerPoint: { x: 118, y: 86 },
      handleXSign: 1,
      handleYSign: 1,
      rotationRadians: 0,
      baseWidth: 20,
      baseHeight: 10,
      minWidth: 1,
      minHeight: 1,
      proportional: false,
      centered: true,
    });

    expect(result.width).toBe(36);
    expect(result.height).toBe(12);
    expect(result.center).toEqual({ x: 100, y: 80 });
  });

  test('computeCornerScaleResult still mirrors by default when centered', () => {
    const result = computeCornerScaleResult({
      referencePoint: { x: 100, y: 80 },
      pointerPoint: { x: 95, y: 77 },
      handleXSign: 1,
      handleYSign: 1,
      rotationRadians: 0,
      baseWidth: 20,
      baseHeight: 10,
      minWidth: 4,
      minHeight: 4,
      proportional: false,
      centered: true,
    });

    expect(result.width).toBe(10);
    expect(result.height).toBe(6);
    expect(result.signedWidth).toBe(-10);
    expect(result.signedHeight).toBe(-6);
    expect(result.center).toEqual({ x: 100, y: 80 });
  });

  test('proportional guide resolves to a diagonal even without a corner handle', () => {
    expect(resolveTransformProportionalGuideDiagonal(null)).toBe(DEFAULT_TRANSFORM_GIZMO_PROPORTIONAL_DIAGONAL);
    expect(resolveTransformProportionalGuideDiagonal('nw')).toBe('nw-se');
    expect(resolveTransformProportionalGuideDiagonal('se')).toBe('nw-se');
    expect(resolveTransformProportionalGuideDiagonal('ne')).toBe('ne-sw');
    expect(resolveTransformProportionalGuideDiagonal('sw')).toBe('ne-sw');
  });

  test('corner proportional guide starts from the stationary opposite corner', () => {
    const corners = {
      nw: { x: 0, y: 0 },
      ne: { x: 10, y: 0 },
      se: { x: 10, y: 10 },
      sw: { x: 0, y: 10 },
    };

    expect(getTransformCornerDiagonal(corners, 'nw')).toEqual({
      start: corners.se,
      end: corners.nw,
    });
    expect(getTransformCornerDiagonal(corners, 'ne')).toEqual({
      start: corners.sw,
      end: corners.ne,
    });
    expect(getTransformCornerDiagonal(corners, 'se')).toEqual({
      start: corners.nw,
      end: corners.se,
    });
    expect(getTransformCornerDiagonal(corners, 'sw')).toEqual({
      start: corners.ne,
      end: corners.sw,
    });
  });

  test('corner scale hit radius expands slightly without stealing the rotate ring', () => {
    const handleRadius = 7;
    const cornerHitRadius = getTransformGizmoCornerHitRadius(handleRadius);
    const rotateRing = getTransformGizmoRotateRingRadii(handleRadius);

    expect(cornerHitRadius).toBeGreaterThan(handleRadius);
    expect(cornerHitRadius).toBeLessThan(rotateRing.innerRadius);
  });

  test('near-corner hover prefers corner scale before edge-like positions', () => {
    const target = hitTransformGizmoCornerTarget(
      { x: 8.2, y: 0 },
      {
        nw: { x: 0, y: 0 },
        ne: { x: 100, y: 0 },
        se: { x: 100, y: 100 },
        sw: { x: 0, y: 100 },
      },
      7,
      7,
      0,
    );

    expect(target).toBe('scale-nw');
  });

  test('rotate ring still wins outside the expanded corner scale radius', () => {
    const target = hitTransformGizmoCornerTarget(
      { x: -9.2, y: -1 },
      {
        nw: { x: 0, y: 0 },
        ne: { x: 100, y: 0 },
        se: { x: 100, y: 100 },
        sw: { x: 0, y: 100 },
      },
      7,
      7,
      0,
    );

    expect(target).toBe('rotate-nw');
  });
});
