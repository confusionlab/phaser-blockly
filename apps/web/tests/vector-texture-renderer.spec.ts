import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('vector texture renderer', () => {
  test('keeps textured stroke dab placement stable when the object translates', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 320;
      const height = 220;
      const translationX = 36.25;
      const createOverlayContext = () => {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        return overlayCanvas.getContext('2d', { willReadFrequently: true });
      };
      const baseCtx = createOverlayContext();
      const translatedCtx = createOverlayContext();
      if (!baseCtx || !translatedCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const createPathObject = (offsetX: number) => ({
        type: 'path',
        path: [
          ['M', 56 + offsetX, 68],
          ['Q', 124 + offsetX, 26, 174 + offsetX, 92],
          ['L', 236 + offsetX, 146],
        ],
        pathOffset: { x: 0, y: 0 },
        fill: null,
        opacity: 1,
        stroke: 'rgba(37, 99, 235, 0)',
        strokeWidth: 20,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        vectorStrokeBrushId: 'marker',
        vectorStrokeColor: '#2563eb',
        vectorStrokeOpacity: 1,
        calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
      });

      renderVectorTextureOverlayForObjects(baseCtx, [createPathObject(0)], {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForObjects(translatedCtx, [createPathObject(translationX)], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const alignedCanvas = document.createElement('canvas');
      alignedCanvas.width = width;
      alignedCanvas.height = height;
      const alignedCtx = alignedCanvas.getContext('2d', { willReadFrequently: true });
      if (!alignedCtx) {
        throw new Error('Failed to acquire aligned overlay context.');
      }
      alignedCtx.drawImage(translatedCtx.canvas, -translationX, 0);

      const basePixels = baseCtx.getImageData(0, 0, width, height).data;
      const alignedPixels = alignedCtx.getImageData(0, 0, width, height).data;

      let opaqueUnion = 0;
      let opaqueIntersection = 0;
      let alphaDifference = 0;
      for (let index = 3; index < basePixels.length; index += 4) {
        const baseAlpha = basePixels[index] ?? 0;
        const alignedAlpha = alignedPixels[index] ?? 0;
        const baseOpaque = baseAlpha > 16;
        const alignedOpaque = alignedAlpha > 16;
        if (baseOpaque || alignedOpaque) {
          opaqueUnion += 1;
        }
        if (baseOpaque && alignedOpaque) {
          opaqueIntersection += 1;
        }
        alphaDifference += Math.abs(baseAlpha - alignedAlpha);
      }

      return {
        opaqueIntersection,
        opaqueUnion,
        averageAlphaDifference: alphaDifference / (width * height),
      };
    });

    expect(result.opaqueUnion).toBeGreaterThan(1800);
    expect(result.opaqueIntersection / result.opaqueUnion).toBeGreaterThan(0.92);
    expect(result.averageAlphaDifference).toBeLessThan(5);
  });

  test('keeps early textured stroke dabs anchored when the path extends', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 320;
      const height = 220;
      const createOverlayContext = () => {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        return overlayCanvas.getContext('2d', { willReadFrequently: true });
      };
      const baseCtx = createOverlayContext();
      const extendedCtx = createOverlayContext();
      if (!baseCtx || !extendedCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const createPathObject = (extendTail: boolean) => ({
        type: 'path',
        path: extendTail
          ? [
              ['M', 52, 112],
              ['C', 90, 62, 132, 58, 172, 102],
              ['L', 214, 132],
              ['L', 260, 146],
            ]
          : [
              ['M', 52, 112],
              ['C', 90, 62, 132, 58, 172, 102],
              ['L', 214, 132],
            ],
        pathOffset: { x: 0, y: 0 },
        fill: null,
        opacity: 1,
        stroke: 'rgba(37, 99, 235, 0)',
        strokeWidth: 20,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        vectorStrokeBrushId: 'marker',
        vectorStrokeColor: '#2563eb',
        vectorStrokeOpacity: 1,
        calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
      });

      renderVectorTextureOverlayForObjects(baseCtx, [createPathObject(false)], {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForObjects(extendedCtx, [createPathObject(true)], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const compareLeft = 28;
      const compareTop = 52;
      const compareWidth = 188;
      const compareHeight = 116;
      const basePixels = baseCtx.getImageData(compareLeft, compareTop, compareWidth, compareHeight).data;
      const extendedPixels = extendedCtx.getImageData(compareLeft, compareTop, compareWidth, compareHeight).data;

      let opaqueUnion = 0;
      let opaqueIntersection = 0;
      let alphaDifference = 0;
      for (let index = 3; index < basePixels.length; index += 4) {
        const baseAlpha = basePixels[index] ?? 0;
        const extendedAlpha = extendedPixels[index] ?? 0;
        const baseOpaque = baseAlpha > 16;
        const extendedOpaque = extendedAlpha > 16;
        if (baseOpaque || extendedOpaque) {
          opaqueUnion += 1;
        }
        if (baseOpaque && extendedOpaque) {
          opaqueIntersection += 1;
        }
        alphaDifference += Math.abs(baseAlpha - extendedAlpha);
      }

      return {
        opaqueIntersection,
        opaqueUnion,
        averageAlphaDifference: alphaDifference / (compareWidth * compareHeight),
      };
    });

    expect(result.opaqueUnion).toBeGreaterThan(2200);
    expect(result.opaqueIntersection / result.opaqueUnion).toBeGreaterThan(0.93);
    expect(result.averageAlphaDifference).toBeLessThan(4);
  });

  test('applies the fabric viewport transform before drawing textured overlays', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForFabricCanvas } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 220;
      const height = 220;
      const baseObjects = [{
        type: 'rect',
        width: 72,
        height: 72,
        strokeWidth: 16,
        fill: 'rgba(34, 197, 94, 0)',
        stroke: 'rgba(37, 99, 235, 0)',
        vectorFillTextureId: 'grain',
        vectorFillColor: '#22c55e',
        vectorFillOpacity: 1,
        vectorStrokeBrushId: 'chalk',
        vectorStrokeColor: '#2563eb',
        vectorStrokeOpacity: 1,
        calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
      }];
      const fabricCanvas = {
        getObjects: () => [{
          ...baseObjects[0],
        }],
        viewportTransform: [1.6, 0, 0, 1.6, 140, 92],
      };
      const untransformedCanvas = {
        getObjects: () => [{
          ...baseObjects[0],
        }],
      };

      const createOverlayContext = () => {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        return overlayCanvas.getContext('2d', { willReadFrequently: true });
      };
      const transformedOverlayCtx = createOverlayContext();
      const untransformedOverlayCtx = createOverlayContext();
      if (!transformedOverlayCtx || !untransformedOverlayCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      renderVectorTextureOverlayForFabricCanvas(transformedOverlayCtx, fabricCanvas, {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForFabricCanvas(untransformedOverlayCtx, untransformedCanvas, {
        canvasWidth: width,
        canvasHeight: height,
      });

      const countOpaquePixelsInRect = (ctx: CanvasRenderingContext2D, left: number, top: number, rectWidth: number, rectHeight: number) => {
        const imageData = ctx.getImageData(left, top, rectWidth, rectHeight).data;
        let count = 0;
        for (let index = 3; index < imageData.length; index += 4) {
          if ((imageData[index] ?? 0) > 0) {
            count += 1;
          }
        }
        return count;
      };

      return {
        transformedExpectedRegionPixels: countOpaquePixelsInRect(transformedOverlayCtx, 84, 36, 112, 112),
        transformedTopLeftPixels: countOpaquePixelsInRect(transformedOverlayCtx, 0, 0, 72, 72),
        untransformedExpectedRegionPixels: countOpaquePixelsInRect(untransformedOverlayCtx, 84, 36, 112, 112),
        untransformedTopLeftPixels: countOpaquePixelsInRect(untransformedOverlayCtx, 0, 0, 72, 72),
      };
    });

    expect(result.transformedExpectedRegionPixels).toBeGreaterThan(400);
    expect(result.transformedExpectedRegionPixels).toBeGreaterThan(result.untransformedExpectedRegionPixels * 4);
    expect(result.transformedTopLeftPixels).toBeLessThan(result.untransformedTopLeftPixels * 0.35);
  });

  test('renders textured fills for open path objects', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 220;
      const height = 220;
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
      if (!overlayCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      renderVectorTextureOverlayForObjects(overlayCtx, [{
        type: 'path',
        path: [
          ['M', 64, 54],
          ['L', 158, 68],
          ['L', 112, 162],
        ],
        pathOffset: { x: 0, y: 0 },
        fill: 'rgba(34, 197, 94, 0)',
        stroke: 'rgba(34, 197, 94, 0)',
        strokeWidth: 0,
        vectorFillTextureId: 'linen',
        vectorFillColor: '#22c55e',
        vectorFillOpacity: 1,
        vectorStrokeBrushId: 'solid',
        vectorStrokeColor: '#22c55e',
        vectorStrokeOpacity: 0,
        calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
      }], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const countVisiblePixelsInRect = (left: number, top: number, rectWidth: number, rectHeight: number) => {
        const imageData = overlayCtx.getImageData(left, top, rectWidth, rectHeight).data;
        let count = 0;
        for (let index = 3; index < imageData.length; index += 4) {
          if ((imageData[index] ?? 0) > 0) {
            count += 1;
          }
        }
        return count;
      };

      return {
        insidePixels: countVisiblePixelsInRect(88, 78, 42, 42),
        outsidePixels: countVisiblePixelsInRect(8, 8, 42, 42),
      };
    });

    expect(result.insidePixels).toBeGreaterThan(600);
    expect(result.outsidePixels).toBe(0);
  });

  test('preserves object stacking when a textured fill sits behind a later solid object', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderComposedVectorSceneForFabricCanvas } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 220;
      const height = 220;

      const createRectObject = (options: {
        fill: string;
        height: number;
        left: number;
        top: number;
        vectorFillColor: string;
        vectorFillTextureId: string;
        width: number;
      }) => ({
        type: 'rect',
        width: options.width,
        height: options.height,
        strokeWidth: 0,
        fill: options.fill,
        opacity: 1,
        vectorFillTextureId: options.vectorFillTextureId,
        vectorFillColor: options.vectorFillColor,
        vectorFillOpacity: 1,
        vectorStrokeBrushId: 'solid',
        vectorStrokeColor: options.vectorFillColor,
        vectorStrokeOpacity: 1,
        calcTransformMatrix: () => [
          1,
          0,
          0,
          1,
          options.left + options.width / 2,
          options.top + options.height / 2,
        ] as [number, number, number, number, number, number],
        render: (ctx: CanvasRenderingContext2D) => {
          ctx.save();
          ctx.translate(options.left + options.width / 2, options.top + options.height / 2);
          ctx.beginPath();
          ctx.rect(-options.width / 2, -options.height / 2, options.width, options.height);
          ctx.fillStyle = options.fill;
          ctx.fill();
          ctx.restore();
        },
      });

      const fabricCanvas = {
        getObjects: () => [
          createRectObject({
            left: 36,
            top: 36,
            width: 132,
            height: 132,
            fill: 'rgba(34, 197, 94, 0)',
            vectorFillTextureId: 'grain',
            vectorFillColor: '#22c55e',
          }),
          createRectObject({
            left: 84,
            top: 84,
            width: 84,
            height: 84,
            fill: '#ef4444',
            vectorFillTextureId: 'solid',
            vectorFillColor: '#ef4444',
          }),
        ],
      };

      const composedCanvas = document.createElement('canvas');
      composedCanvas.width = width;
      composedCanvas.height = height;
      const composedCtx = composedCanvas.getContext('2d', { willReadFrequently: true });
      if (!composedCtx) {
        throw new Error('Failed to acquire composed vector scene context.');
      }

      renderComposedVectorSceneForFabricCanvas(composedCtx, fabricCanvas, {
        canvasWidth: width,
        canvasHeight: height,
      });

      const readPixel = (x: number, y: number) => {
        const data = composedCtx.getImageData(x, y, 1, 1).data;
        return {
          r: data[0] ?? 0,
          g: data[1] ?? 0,
          b: data[2] ?? 0,
          a: data[3] ?? 0,
        };
      };
      const countOpaquePixelsInRect = (left: number, top: number, rectWidth: number, rectHeight: number) => {
        const imageData = composedCtx.getImageData(left, top, rectWidth, rectHeight).data;
        let count = 0;
        for (let index = 3; index < imageData.length; index += 4) {
          if ((imageData[index] ?? 0) > 0) {
            count += 1;
          }
        }
        return count;
      };

      return {
        overlap: readPixel(120, 120),
        texturedOnlyOpaquePixels: countOpaquePixelsInRect(48, 48, 32, 32),
      };
    });

    expect(result.overlap.a).toBeGreaterThan(200);
    expect(result.overlap.r).toBeGreaterThan(result.overlap.g * 1.5);
    expect(result.texturedOnlyOpaquePixels).toBeGreaterThan(20);
  });

  test('renders transient textured preview paths passed as additional overlay objects', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForFabricCanvas } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 260;
      const height = 220;
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
      if (!overlayCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      renderVectorTextureOverlayForFabricCanvas(overlayCtx, {
        getObjects: () => [],
        viewportTransform: [1.45, 0, 0, 1.45, 46, 28],
      }, {
        canvasWidth: width,
        canvasHeight: height,
        additionalObjects: [{
          type: 'path',
          path: [
            ['M', 24, 28],
            ['L', 94, 56],
            ['L', 136, 108],
          ],
          pathOffset: { x: 0, y: 0 },
          fill: null,
          opacity: 1,
          stroke: 'rgba(37, 99, 235, 0)',
          strokeWidth: 20,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          vectorStrokeBrushId: 'marker',
          vectorStrokeColor: '#2563eb',
          vectorStrokeOpacity: 1,
          calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
        }],
      });

      const countVisiblePixelsInRect = (left: number, top: number, rectWidth: number, rectHeight: number) => {
        const imageData = overlayCtx.getImageData(left, top, rectWidth, rectHeight).data;
        let count = 0;
        for (let index = 3; index < imageData.length; index += 4) {
          if ((imageData[index] ?? 0) > 0) {
            count += 1;
          }
        }
        return count;
      };

      return {
        transformedPreviewPixels: countVisiblePixelsInRect(70, 44, 150, 120),
        topLeftPixels: countVisiblePixelsInRect(0, 0, 36, 36),
      };
    });

    expect(result.transformedPreviewPixels).toBeGreaterThan(900);
    expect(result.topLeftPixels).toBe(0);
  });

  test('renders textured stroke width previews for textured brushes', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorStrokeBrushPreview } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 136;
      const height = 88;
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
      if (!overlayCtx) {
        throw new Error('Failed to acquire stroke preview context.');
      }

      renderVectorStrokeBrushPreview(overlayCtx, {
        brushId: 'chalk',
        canvasWidth: width,
        canvasHeight: height,
        strokeColor: '#2563eb',
        strokeOpacity: 1,
        strokeWidth: 22,
      });

      const countVisiblePixelsInRect = (left: number, top: number, rectWidth: number, rectHeight: number) => {
        const imageData = overlayCtx.getImageData(left, top, rectWidth, rectHeight).data;
        let count = 0;
        for (let index = 3; index < imageData.length; index += 4) {
          if ((imageData[index] ?? 0) > 0) {
            count += 1;
          }
        }
        return count;
      };

      return {
        centerStrokePixels: countVisiblePixelsInRect(16, 24, 104, 40),
        topLeftPixels: countVisiblePixelsInRect(0, 0, 12, 12),
      };
    });

    expect(result.centerStrokePixels).toBeGreaterThan(500);
    expect(result.topLeftPixels).toBe(0);
  });
});
