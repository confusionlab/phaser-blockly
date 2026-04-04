import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('costume document textured vector rendering', () => {
  test('keeps solid strokes above textured fills', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [{ createVectorLayer }, { renderCostumeLayerToCanvas }] = await Promise.all([
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/lib/costume/costumeDocumentRender.ts'),
      ]);

      const layer = createVectorLayer({
        name: 'Textured Fill With Solid Stroke',
        fabricJson: JSON.stringify({
          version: '7.0.0',
          objects: [{
            type: 'rect',
            version: '7.0.0',
            originX: 'center',
            originY: 'center',
            left: 512,
            top: 512,
            width: 260,
            height: 220,
            fill: 'rgba(239, 68, 68, 0)',
            stroke: '#2563eb',
            strokeWidth: 40,
            strokeUniform: true,
            noScaleCache: false,
            vectorFillTextureId: 'grain',
            vectorFillColor: '#ef4444',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#2563eb',
            vectorStrokeOpacity: 1,
          }],
        }),
      });

      const canvas = await renderCostumeLayerToCanvas(layer);
      if (!canvas) {
        throw new Error('Expected textured vector layer to render.');
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error('Failed to acquire rendered layer context.');
      }

      let firstOpaqueX = -1;
      for (let x = 0; x < canvas.width; x += 1) {
        const alpha = ctx.getImageData(x, 512, 1, 1).data[3] ?? 0;
        if (alpha > 0) {
          firstOpaqueX = x;
          break;
        }
      }
      if (firstOpaqueX < 0) {
        throw new Error('Expected to find opaque pixels on the center scanline.');
      }

      let strokeSampleX = -1;
      for (let x = firstOpaqueX; x < Math.min(canvas.width, firstOpaqueX + 80); x += 1) {
        const pixel = ctx.getImageData(x, 512, 1, 1).data;
        const red = pixel[0] ?? 0;
        const blue = pixel[2] ?? 0;
        if ((pixel[3] ?? 0) > 0 && blue > red) {
          strokeSampleX = x;
          break;
        }
      }
      if (strokeSampleX < 0) {
        throw new Error('Expected to find a blue-dominant solid stroke pixel on the center scanline.');
      }

      const strokePixel = ctx.getImageData(strokeSampleX, 512, 1, 1).data;
      const innerStrokePixel = ctx.getImageData(strokeSampleX + 10, 512, 1, 1).data;
      let fillSampleX = -1;
      let fillPixel: Uint8ClampedArray | null = null;
      for (let x = strokeSampleX + 30; x < Math.min(canvas.width, strokeSampleX + 180); x += 1) {
        const pixel = ctx.getImageData(x, 512, 1, 1).data;
        const red = pixel[0] ?? 0;
        const blue = pixel[2] ?? 0;
        if ((pixel[3] ?? 0) > 0 && red > blue) {
          fillSampleX = x;
          fillPixel = pixel;
          break;
        }
      }
      if (!fillPixel || fillSampleX < 0) {
        throw new Error('Expected to find a red-dominant textured fill pixel on the center scanline.');
      }

      return {
        firstOpaqueX,
        fillSampleX,
        strokeSampleX,
        stroke: {
          red: strokePixel[0] ?? 0,
          green: strokePixel[1] ?? 0,
          blue: strokePixel[2] ?? 0,
          alpha: strokePixel[3] ?? 0,
        },
        innerStroke: {
          red: innerStrokePixel[0] ?? 0,
          green: innerStrokePixel[1] ?? 0,
          blue: innerStrokePixel[2] ?? 0,
          alpha: innerStrokePixel[3] ?? 0,
        },
        fill: {
          red: fillPixel[0] ?? 0,
          green: fillPixel[1] ?? 0,
          blue: fillPixel[2] ?? 0,
          alpha: fillPixel[3] ?? 0,
        },
      };
    });

    expect(result.stroke.alpha).toBeGreaterThan(0);
    expect(result.stroke.blue).toBeGreaterThan(result.stroke.red);
    expect(result.innerStroke.alpha).toBeGreaterThan(0);
    expect(result.innerStroke.blue).toBeGreaterThan(result.innerStroke.red);
    expect(result.firstOpaqueX).toBeGreaterThan(0);
    expect(result.fillSampleX).toBeGreaterThan(result.strokeSampleX);
    expect(result.strokeSampleX).toBeGreaterThan(0);
    expect(result.fill.alpha).toBeGreaterThan(0);
    expect(result.fill.red).toBeGreaterThan(result.fill.blue);
  });

  test('renders textured vector layers for inactive surfaces, previews, and runtime assets', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const renderCounts = await page.evaluate(async () => {
      const [
        { createBitmapLayer, createVectorLayer },
        {
          renderCostumeDocument,
          renderCostumeDocumentPreview,
          renderCostumeLayerToCanvas,
        },
      ] = await Promise.all([
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/lib/costume/costumeDocumentRender.ts'),
      ]);

      const countOpaquePixels = (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return 0;
        }

        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let opaquePixels = 0;
        for (let index = 3; index < data.length; index += 4) {
          if ((data[index] ?? 0) > 0) {
            opaquePixels += 1;
          }
        }
        return opaquePixels;
      };

      const countOpaquePixelsFromDataUrl = async (dataUrl: string) => {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const nextImage = new Image();
          nextImage.onload = () => resolve(nextImage);
          nextImage.onerror = () => reject(new Error('Failed to decode rendered costume image.'));
          nextImage.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return 0;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return countOpaquePixels(canvas);
      };

      const texturedVectorLayer = createVectorLayer({
        name: 'Textured Vector',
        fabricJson: JSON.stringify({
          version: '7.0.0',
          objects: [{
            type: 'rect',
            version: '7.0.0',
            originX: 'center',
            originY: 'center',
            left: 512,
            top: 512,
            width: 320,
            height: 240,
            fill: 'rgba(255, 99, 71, 0)',
            stroke: 'rgba(37, 99, 235, 0)',
            strokeWidth: 28,
            strokeUniform: true,
            noScaleCache: false,
            vectorFillTextureId: 'grain',
            vectorFillColor: '#ff6347',
            vectorStrokeBrushId: 'chalk',
            vectorStrokeColor: '#2563eb',
          }],
        }),
      });
      const inactiveBitmapLayer = createBitmapLayer({
        name: 'Bitmap Base',
        assetId: null,
      });
      const costumeDocument = {
        version: 1 as const,
        activeLayerId: inactiveBitmapLayer.id,
        layers: [inactiveBitmapLayer, texturedVectorLayer],
      };

      const layerCanvas = await renderCostumeLayerToCanvas(texturedVectorLayer);
      const preview = await renderCostumeDocumentPreview(costumeDocument);
      const runtime = await renderCostumeDocument(costumeDocument);

      return {
        layerPixels: layerCanvas ? countOpaquePixels(layerCanvas) : 0,
        previewPixels: await countOpaquePixelsFromDataUrl(preview.dataUrl),
        runtimePixels: await countOpaquePixelsFromDataUrl(runtime.dataUrl),
      };
    });

    expect(renderCounts.layerPixels).toBeGreaterThan(0);
    expect(renderCounts.previewPixels).toBeGreaterThan(0);
    expect(renderCounts.runtimePixels).toBeGreaterThan(0);
  });

  test('trims sparse runtime assets and reconstructs them with frame metadata', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const renderResult = await page.evaluate(async () => {
      const [
        { createBitmapLayer, createVectorLayer },
        {
          renderCostumeDocument,
          renderCostumeDocumentPreview,
          renderCostumeLayerToCanvas,
        },
        { calculateBoundsFromCanvas },
      ] = await Promise.all([
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/lib/costume/costumeDocumentRender.ts'),
        import('/src/utils/imageBounds.ts'),
      ]);

      const offCenterVectorLayer = createVectorLayer({
        name: 'Off Center Vector',
        fabricJson: JSON.stringify({
          version: '7.0.0',
          objects: [{
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 104,
            top: 236,
            width: 84,
            height: 56,
            fill: '#0f766e',
            strokeWidth: 0,
            rx: 0,
            ry: 0,
          }],
        }),
      });

      const runtimeDocument = {
        version: 1 as const,
        activeLayerId: offCenterVectorLayer.id,
        layers: [offCenterVectorLayer],
      };

      const runtime = await renderCostumeDocument(runtimeDocument);
      const runtimeImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to decode optimized runtime asset.'));
        image.src = runtime.dataUrl;
      });

      const optimizedBitmapLayer = createBitmapLayer({
        name: 'Optimized Bitmap',
        assetId: runtime.dataUrl,
        assetFrame: runtime.assetFrame ?? null,
      });
      const optimizedBitmapDocument = {
        version: 1 as const,
        activeLayerId: optimizedBitmapLayer.id,
        layers: [optimizedBitmapLayer],
      };

      const rebuiltCanvas = await renderCostumeLayerToCanvas(optimizedBitmapLayer);
      const rebuiltBounds = rebuiltCanvas ? calculateBoundsFromCanvas(rebuiltCanvas) : null;
      const preview = await renderCostumeDocumentPreview(optimizedBitmapDocument);

      return {
        assetFrame: runtime.assetFrame ?? null,
        previewBounds: preview.bounds,
        rebuiltBounds,
        runtimeBounds: runtime.bounds,
        runtimeHeight: runtimeImage.naturalHeight || runtimeImage.height,
        runtimeWidth: runtimeImage.naturalWidth || runtimeImage.width,
      };
    });

    expect(renderResult.assetFrame).not.toBeNull();
    expect(renderResult.assetFrame?.x ?? 0).toBeGreaterThan(0);
    expect(renderResult.assetFrame?.y ?? 0).toBeGreaterThan(0);
    expect(renderResult.runtimeWidth).toBe(renderResult.assetFrame?.width);
    expect(renderResult.runtimeHeight).toBe(renderResult.assetFrame?.height);
    expect(renderResult.runtimeWidth).toBeLessThan(1024);
    expect(renderResult.runtimeHeight).toBeLessThan(1024);
    expect(renderResult.rebuiltBounds).toEqual(renderResult.runtimeBounds);
    expect(renderResult.previewBounds).toEqual(renderResult.runtimeBounds);
  });
});
