import { expect, test } from '@playwright/test';
import {
  buildPolygonShapeDraft,
  getFabricShapeDraftObjectProps,
  resolveShapeDraft,
  translateShapeDraftResolution,
} from '../src/components/editors/costume/costumeCanvasShared';

test.describe('shape draft gestures', () => {
  test('triangle and star drafts resolve from two gesture corners by default', () => {
    expect(resolveShapeDraft('triangle', { x: 120, y: 80 }, { x: 260, y: 220 })).toEqual({
      start: { x: 120, y: 80 },
      end: { x: 260, y: 220 },
    });

    expect(resolveShapeDraft('star', { x: 260, y: 220 }, { x: 120, y: 80 })).toEqual({
      start: { x: 260, y: 220 },
      end: { x: 120, y: 80 },
    });
  });

  test('option-centered drafts mirror the gesture around the anchor', () => {
    expect(resolveShapeDraft('rectangle', { x: 200, y: 160 }, { x: 260, y: 210 }, { centered: true })).toEqual({
      start: { x: 140, y: 110 },
      end: { x: 260, y: 210 },
    });

    expect(resolveShapeDraft('line', { x: 200, y: 160 }, { x: 260, y: 210 }, { centered: true })).toEqual({
      start: { x: 140, y: 110 },
      end: { x: 260, y: 210 },
    });
  });

  test('shift constrains box-based shapes to equal width and height', () => {
    expect(resolveShapeDraft('rectangle', { x: 10, y: 20 }, { x: 70, y: 45 }, { proportional: true })).toEqual({
      start: { x: 10, y: 20 },
      end: { x: 70, y: 80 },
    });

    expect(resolveShapeDraft('circle', { x: 10, y: 20 }, { x: -30, y: 65 }, { proportional: true })).toEqual({
      start: { x: 10, y: 20 },
      end: { x: -35, y: 65 },
    });
  });

  test('shift snaps lines to the nearest 45 degree increment', () => {
    const snappedHorizontal = resolveShapeDraft(
      'line',
      { x: 0, y: 0 },
      { x: 80, y: 10 },
      { proportional: true },
    );
    expect(snappedHorizontal.start).toEqual({ x: 0, y: 0 });
    expect(snappedHorizontal.end.y).toBeCloseTo(0, 5);
    expect(snappedHorizontal.end.x).toBeCloseTo(Math.hypot(80, 10), 5);

    const snappedDiagonal = resolveShapeDraft(
      'line',
      { x: 0, y: 0 },
      { x: 30, y: 70 },
      { proportional: true },
    );
    expect(snappedDiagonal.end.x).toBeCloseTo(snappedDiagonal.end.y, 5);
  });

  test('space-translation can move a resolved draft without changing its size', () => {
    const translated = translateShapeDraftResolution(
      resolveShapeDraft('star', { x: 100, y: 100 }, { x: 180, y: 160 }, { proportional: true }),
      { x: 35, y: -20 },
    );

    expect(translated).toEqual({
      start: { x: 135, y: 80 },
      end: { x: 215, y: 160 },
    });
  });

  test('polygon drafts derive their bounds from the resolved corners', () => {
    const polygon = buildPolygonShapeDraft('triangle', { x: 220, y: 180 }, { x: 100, y: 60 });

    expect(polygon.left).toBe(160);
    expect(polygon.top).toBe(120);
    expect(polygon.points).toEqual([
      { x: 60, y: 0 },
      { x: 120, y: 120 },
      { x: 0, y: 120 },
    ]);
  });

  test('fabric shape draft geometry keeps rectangle and circle corners aligned while compensating stroke width', () => {
    expect(
      getFabricShapeDraftObjectProps('rectangle', { x: 120, y: 80 }, { x: 260, y: 220 }, 24),
    ).toEqual({
      left: 108,
      top: 68,
      width: 140,
      height: 140,
    });

    expect(
      getFabricShapeDraftObjectProps('circle', { x: 260, y: 220 }, { x: 120, y: 80 }, 24),
    ).toEqual({
      left: 108,
      top: 68,
      rx: 70,
      ry: 70,
    });
  });
});
