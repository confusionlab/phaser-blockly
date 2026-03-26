import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

function expectPixelsClose(
  actual: number[] | null | undefined,
  expected: number[] | null | undefined,
  tolerance: number = 1,
) {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expect(actual?.length).toBe(expected?.length);
  for (let index = 0; index < (actual?.length ?? 0); index += 1) {
    expect(Math.abs((actual?.[index] ?? 0) - (expected?.[index] ?? 0))).toBeLessThanOrEqual(tolerance);
  }
}

test.describe('costume layer operations', () => {
  test('rasterize preserves layer opacity in the rendered result', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createVectorLayer },
        { renderCostumeLayerToCanvas },
        { rasterizeCostumeLayer },
      ] = await Promise.all([
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/lib/costume/costumeDocumentRender.ts'),
        import('/src/lib/costume/costumeLayerOperations.ts'),
      ]);

      const readPixel = (canvas: HTMLCanvasElement | null, x: number, y: number) => {
        if (!canvas) {
          return null;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return null;
        }
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      };

      const sourceLayer = createVectorLayer({
        name: 'Semitransparent Vector',
        opacity: 0.5,
        fabricJson: JSON.stringify({
          version: '7.0.0',
          objects: [{
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 256,
            top: 256,
            width: 512,
            height: 512,
            fill: '#0f172a',
            strokeWidth: 0,
          }],
        }),
      });

      const originalCanvas = await renderCostumeLayerToCanvas(sourceLayer);
      const rasterizedLayer = await rasterizeCostumeLayer(sourceLayer);
      const rasterizedCanvas = rasterizedLayer
        ? await renderCostumeLayerToCanvas(rasterizedLayer)
        : null;

      return {
        originalPixel: readPixel(originalCanvas, 512, 512),
        rasterizedPixel: readPixel(rasterizedCanvas, 512, 512),
        rasterizedOpacity: rasterizedLayer?.opacity ?? null,
      };
    });

    expect(result.originalPixel).not.toBeNull();
    expect(result.rasterizedPixel).not.toBeNull();
    expect(result.rasterizedOpacity).toBeCloseTo(0.5, 5);
    expect(result.rasterizedPixel?.[3]).toBeGreaterThan(0);
    expect(result.rasterizedPixel?.[3]).toBe(result.originalPixel?.[3]);
    expectPixelsClose(result.rasterizedPixel, result.originalPixel);
  });

  test('merge down preserves semitransparent layer compositing', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createVectorLayer },
        { renderCostumeLayerStackToCanvas, renderCostumeLayerToCanvas },
        { mergeCostumeLayers },
      ] = await Promise.all([
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/lib/costume/costumeDocumentRender.ts'),
        import('/src/lib/costume/costumeLayerOperations.ts'),
      ]);

      const readPixel = (canvas: HTMLCanvasElement | null, x: number, y: number) => {
        if (!canvas) {
          return null;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return null;
        }
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      };

      const lowerLayer = createVectorLayer({
        name: 'Lower',
        opacity: 0.5,
        fabricJson: JSON.stringify({
          version: '7.0.0',
          objects: [{
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 256,
            top: 256,
            width: 512,
            height: 512,
            fill: '#ef4444',
            strokeWidth: 0,
          }],
        }),
      });
      const upperLayer = createVectorLayer({
        name: 'Upper',
        opacity: 0.5,
        fabricJson: JSON.stringify({
          version: '7.0.0',
          objects: [{
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 384,
            top: 384,
            width: 256,
            height: 256,
            fill: '#2563eb',
            strokeWidth: 0,
          }],
        }),
      });

      const mergedLayer = await mergeCostumeLayers(lowerLayer, upperLayer);
      const expectedCanvas = await renderCostumeLayerStackToCanvas([lowerLayer, upperLayer]);
      const mergedCanvas = await renderCostumeLayerToCanvas(mergedLayer);

      return {
        expectedPixel: readPixel(expectedCanvas, 512, 512),
        mergedPixel: readPixel(mergedCanvas, 512, 512),
        mergedKind: mergedLayer.kind,
        mergedOpacity: mergedLayer.opacity,
      };
    });

    expect(result.expectedPixel).not.toBeNull();
    expect(result.mergedPixel).not.toBeNull();
    expect(result.mergedKind).toBe('bitmap');
    expect(result.mergedOpacity).toBe(1);
    expectPixelsClose(result.mergedPixel, result.expectedPixel);
  });
});
