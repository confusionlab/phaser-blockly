import { expect, test } from '@playwright/test';
import {
  getMappedObjectOverlayCorners,
  getVectorObjectOutlinePointsForPathConversion,
} from '../src/components/editors/costume/useCostumeCanvasVectorObjectController';

test.describe('vector object overlay corners', () => {
  test('maps scene coordinates through the provided overlay mapper', () => {
    const target = {
      getCoords() {
        return [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 50 },
          { x: 10, y: 50 },
        ];
      },
      oCoords: {
        tl: { x: 999, y: 999 },
        tr: { x: 999, y: 999 },
        br: { x: 999, y: 999 },
        bl: { x: 999, y: 999 },
      },
    };

    const corners = getMappedObjectOverlayCorners(target, (point) => ({
      x: point.x * 2 + 5,
      y: point.y * 3 - 4,
    }) as any);

    expect(corners).toEqual({
      nw: { x: 25, y: 56 },
      ne: { x: 65, y: 56 },
      se: { x: 65, y: 146 },
      sw: { x: 25, y: 146 },
    });
  });

  test('returns null when the target does not expose four finite scene corners', () => {
    expect(getMappedObjectOverlayCorners(null, (point) => point)).toBeNull();
    expect(getMappedObjectOverlayCorners({
      getCoords() {
        return [{ x: 10, y: 20 }];
      },
    }, (point) => point)).toBeNull();
    expect(getMappedObjectOverlayCorners({
      getCoords() {
        return [
          { x: 10, y: 20 },
          { x: Number.NaN, y: 20 },
          { x: 30, y: 50 },
          { x: 10, y: 50 },
        ];
      },
    }, (point) => point)).toBeNull();
  });

  test('converts rectangles from their geometric width and height instead of stroked coords', () => {
    const outline = getVectorObjectOutlinePointsForPathConversion({
      type: 'rect',
      width: 100,
      height: 40,
      getCoords() {
        return [
          { x: 999, y: 999 },
          { x: 999, y: 999 },
          { x: 999, y: 999 },
          { x: 999, y: 999 },
        ];
      },
    }, (_target, x, y) => ({ x: x + 200, y: y + 300 }) as any);

    expect(outline).toEqual({
      points: [
        { x: 150, y: 280 },
        { x: 250, y: 280 },
        { x: 250, y: 320 },
        { x: 150, y: 320 },
      ],
      closed: true,
    });
  });
});
