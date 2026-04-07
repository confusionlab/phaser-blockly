import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('vector texture renderer', () => {
  test('shares the same canonical crayon texture source between fill and stroke', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { getVectorFillTexturePreset } = await import('/src/lib/vector/vectorFillTextureCore.ts');
      const { getVectorStrokeBrushPreset } = await import('/src/lib/vector/vectorStrokeBrushCore.ts');

      const fillPreset = getVectorFillTexturePreset('crayon');
      const strokePreset = getVectorStrokeBrushPreset('crayon');

      return {
        fillTexturePath: fillPreset.texturePath ?? null,
        strokeTexturePath: strokePreset.texturePath ?? null,
        strokeMaskPath: strokePreset.maskPath ?? null,
      };
    });

    expect(result.fillTexturePath).toBe('/vector-materials/crayon/texture.png');
    expect(result.strokeTexturePath).toBe(result.fillTexturePath);
    expect(result.strokeMaskPath).toBe('/vector-materials/crayon/dab-mask.png');
  });

  test('uses the shared crayon texture as a masked stroke field when assets are available', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { createVectorStrokeBrushRenderStyle } = await import('/src/lib/vector/vectorStrokeBrushCore.ts');
      const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load ${src}`));
        image.src = src;
      });

      const [textureSource, maskSource] = await Promise.all([
        loadImage('/vector-materials/crayon/texture.png'),
        loadImage('/vector-materials/crayon/dab-mask.png'),
      ]);

      const renderStyle = createVectorStrokeBrushRenderStyle('crayon', '#2563eb', 18, {
        textureSource,
        maskSource,
      });

      return {
        dabCount: 'dabs' in renderStyle ? renderStyle.dabs.length : 0,
        kind: renderStyle.kind,
        textureTileHeight: 'textureTile' in renderStyle ? renderStyle.textureTile.height : null,
        textureTileWidth: 'textureTile' in renderStyle ? renderStyle.textureTile.width : null,
      };
    });

    expect(result.kind).toBe('texture-mask-dab');
    expect(result.dabCount).toBe(1);
    expect(result.textureTileWidth).toBeGreaterThan(0);
    expect(result.textureTileHeight).toBe(result.textureTileWidth);
  });

  test('renders crayon fill as an opaque textured color field', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 280;
      const height = 240;
      const sampleLeft = 142;
      const sampleTop = 102;
      const sampleWidth = 36;
      const sampleHeight = 36;

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
      if (!overlayCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const object = {
        type: 'rect',
        width: 72,
        height: 72,
        fill: 'rgba(37, 99, 235, 0)',
        opacity: 1,
        stroke: null,
        strokeWidth: 0,
        vectorFillTextureId: 'crayon',
        vectorFillColor: '#2563eb',
        vectorFillOpacity: 1,
        calcTransformMatrix: () => [1, 0, 0, 1, 160, 120],
      };

      const waitForTextureReady = () => new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        renderVectorTextureOverlayForObjects(overlayCtx, [object], {
          canvasWidth: width,
          canvasHeight: height,
          onTextureSourceReady: done,
        });
        setTimeout(done, 100);
      });

      await waitForTextureReady();
      overlayCtx.clearRect(0, 0, width, height);
      renderVectorTextureOverlayForObjects(overlayCtx, [object], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const pixels = overlayCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;
      let alphaTotal = 0;
      let minAlpha = 255;
      const uniqueColors = new Set<string>();
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        const alpha = pixels[index + 3] ?? 0;
        alphaTotal += alpha;
        minAlpha = Math.min(minAlpha, alpha);
        uniqueColors.add(`${red},${green},${blue}`);
      }

      return {
        averageAlpha: alphaTotal / (sampleWidth * sampleHeight),
        minAlpha,
        uniqueColorCount: uniqueColors.size,
      };
    });

    expect(result.averageAlpha).toBeGreaterThan(250);
    expect(result.minAlpha).toBeGreaterThan(245);
    expect(result.uniqueColorCount).toBeGreaterThan(20);
  });

  test('renders visible crayon variation for dark fill colors', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 280;
      const height = 240;
      const sampleLeft = 142;
      const sampleTop = 102;
      const sampleWidth = 36;
      const sampleHeight = 36;

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
      if (!overlayCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const object = {
        type: 'rect',
        width: 72,
        height: 72,
        fill: 'rgba(10, 20, 40, 0)',
        opacity: 1,
        stroke: null,
        strokeWidth: 0,
        vectorFillTextureId: 'crayon',
        vectorFillColor: '#0f172a',
        vectorFillOpacity: 1,
        calcTransformMatrix: () => [1, 0, 0, 1, 160, 120],
      };

      const waitForTextureReady = () => new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        renderVectorTextureOverlayForObjects(overlayCtx, [object], {
          canvasWidth: width,
          canvasHeight: height,
          onTextureSourceReady: done,
        });
        setTimeout(done, 100);
      });

      await waitForTextureReady();
      overlayCtx.clearRect(0, 0, width, height);
      renderVectorTextureOverlayForObjects(overlayCtx, [object], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const pixels = overlayCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;
      let minAlpha = 255;
      let minLuminance = 255;
      let maxLuminance = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        const alpha = pixels[index + 3] ?? 0;
        const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
        minAlpha = Math.min(minAlpha, alpha);
        minLuminance = Math.min(minLuminance, luminance);
        maxLuminance = Math.max(maxLuminance, luminance);
      }

      return {
        luminanceSpread: maxLuminance - minLuminance,
        minAlpha,
      };
    });

    expect(result.minAlpha).toBeGreaterThan(245);
    expect(result.luminanceSpread).toBeGreaterThan(18);
  });

  test('extends textured fill into the textured stroke fringe to avoid a hard interior edge', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 320;
      const height = 240;
      const sampleLeft = 116;
      const sampleTop = 86;
      const sampleWidth = 10;
      const sampleHeight = 68;

      const createOverlayContext = () => {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        return overlayCanvas.getContext('2d', { willReadFrequently: true });
      };
      const fillOnlyCtx = createOverlayContext();
      const fillAndStrokeCtx = createOverlayContext();
      if (!fillOnlyCtx || !fillAndStrokeCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const createRectObject = (includeStroke: boolean) => ({
        type: 'rect',
        width: 72,
        height: 72,
        fill: 'rgba(37, 99, 235, 0)',
        opacity: 1,
        stroke: includeStroke ? 'rgba(37, 99, 235, 0)' : null,
        strokeWidth: includeStroke ? 20 : 0,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        vectorFillTextureId: 'crayon',
        vectorFillColor: '#2563eb',
        vectorFillOpacity: 1,
        vectorStrokeBrushId: includeStroke ? 'crayon' : 'solid',
        vectorStrokeColor: includeStroke ? '#2563eb' : undefined,
        vectorStrokeOpacity: includeStroke ? 1 : undefined,
        calcTransformMatrix: () => [1, 0, 0, 1, 160, 120],
      });

      const waitForTextureReady = () => new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        renderVectorTextureOverlayForObjects(fillAndStrokeCtx, [createRectObject(true)], {
          canvasWidth: width,
          canvasHeight: height,
          onTextureSourceReady: done,
        });
        setTimeout(done, 100);
      });

      await waitForTextureReady();
      fillOnlyCtx.clearRect(0, 0, width, height);
      fillAndStrokeCtx.clearRect(0, 0, width, height);

      renderVectorTextureOverlayForObjects(fillOnlyCtx, [createRectObject(false)], {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForObjects(fillAndStrokeCtx, [createRectObject(true)], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const fillOnlyPixels = fillOnlyCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;
      const fillAndStrokePixels = fillAndStrokeCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;

      let fillOnlyAlphaTotal = 0;
      let fillAndStrokeAlphaTotal = 0;
      for (let index = 3; index < fillOnlyPixels.length; index += 4) {
        fillOnlyAlphaTotal += fillOnlyPixels[index] ?? 0;
        fillAndStrokeAlphaTotal += fillAndStrokePixels[index] ?? 0;
      }

      const samplePixelCount = sampleWidth * sampleHeight;
      return {
        fillAndStrokeAverageAlpha: fillAndStrokeAlphaTotal / samplePixelCount,
        fillOnlyAverageAlpha: fillOnlyAlphaTotal / samplePixelCount,
      };
    });

    expect(result.fillAndStrokeAverageAlpha).toBeGreaterThan(result.fillOnlyAverageAlpha + 20);
  });

  test('changing textured stroke color does not change the shared coverage field', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 320;
      const height = 240;

      const createOverlayContext = () => {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        return overlayCanvas.getContext('2d', { willReadFrequently: true });
      };
      const sameColorCtx = createOverlayContext();
      const differentColorCtx = createOverlayContext();
      if (!sameColorCtx || !differentColorCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const createRectObject = (strokeColor: string) => ({
        type: 'rect',
        width: 72,
        height: 72,
        fill: 'rgba(37, 99, 235, 0)',
        opacity: 1,
        stroke: 'rgba(37, 99, 235, 0)',
        strokeWidth: 20,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        vectorFillTextureId: 'crayon',
        vectorFillColor: '#2563eb',
        vectorFillOpacity: 1,
        vectorStrokeBrushId: 'crayon',
        vectorStrokeColor: strokeColor,
        vectorStrokeOpacity: 1,
        calcTransformMatrix: () => [1, 0, 0, 1, 160, 120],
      });

      const waitForTextureReady = () => new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        renderVectorTextureOverlayForObjects(sameColorCtx, [createRectObject('#2563eb')], {
          canvasWidth: width,
          canvasHeight: height,
          onTextureSourceReady: done,
        });
        setTimeout(done, 100);
      });

      await waitForTextureReady();
      sameColorCtx.clearRect(0, 0, width, height);
      differentColorCtx.clearRect(0, 0, width, height);

      renderVectorTextureOverlayForObjects(sameColorCtx, [createRectObject('#2563eb')], {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForObjects(differentColorCtx, [createRectObject('#ef4444')], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const sameColorPixels = sameColorCtx.getImageData(0, 0, width, height).data;
      const differentColorPixels = differentColorCtx.getImageData(0, 0, width, height).data;

      let alphaDifference = 0;
      let opaqueUnion = 0;
      let opaqueIntersection = 0;
      for (let index = 3; index < sameColorPixels.length; index += 4) {
        const sameColorAlpha = sameColorPixels[index] ?? 0;
        const differentColorAlpha = differentColorPixels[index] ?? 0;
        const sameColorVisible = sameColorAlpha > 16;
        const differentColorVisible = differentColorAlpha > 16;
        if (sameColorVisible || differentColorVisible) {
          opaqueUnion += 1;
        }
        if (sameColorVisible && differentColorVisible) {
          opaqueIntersection += 1;
        }
        alphaDifference += Math.abs(sameColorAlpha - differentColorAlpha);
      }

      return {
        averageAlphaDifference: alphaDifference / (width * height),
        opaqueIntersection,
        opaqueUnion,
      };
    });

    expect(result.opaqueUnion).toBeGreaterThan(2500);
    expect(result.opaqueIntersection / result.opaqueUnion).toBeGreaterThan(0.98);
    expect(result.averageAlphaDifference).toBeLessThan(1);
  });

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
        vectorStrokeBrushId: 'crayon',
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

  test('keeps crayon fill texture density stable when the object scales', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 320;
      const height = 240;
      const sampleLeft = 136;
      const sampleTop = 96;
      const sampleWidth = 48;
      const sampleHeight = 48;

      const createOverlayContext = () => {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        return overlayCanvas.getContext('2d', { willReadFrequently: true });
      };
      const baseCtx = createOverlayContext();
      const scaledCtx = createOverlayContext();
      if (!baseCtx || !scaledCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const createRectObject = (scale: number) => ({
        type: 'rect',
        width: 72,
        height: 72,
        fill: 'rgba(37, 99, 235, 0)',
        opacity: 1,
        stroke: null,
        strokeWidth: 0,
        vectorFillTextureId: 'crayon',
        vectorFillColor: '#2563eb',
        vectorFillOpacity: 1,
        calcTransformMatrix: () => [scale, 0, 0, scale, 160, 120],
      });

      const waitForTextureReady = () => new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        renderVectorTextureOverlayForObjects(baseCtx, [createRectObject(1)], {
          canvasWidth: width,
          canvasHeight: height,
          onTextureSourceReady: done,
        });
        setTimeout(done, 100);
      });

      await waitForTextureReady();
      baseCtx.clearRect(0, 0, width, height);
      scaledCtx.clearRect(0, 0, width, height);

      renderVectorTextureOverlayForObjects(baseCtx, [createRectObject(1)], {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForObjects(scaledCtx, [createRectObject(2)], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const basePixels = baseCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;
      const scaledPixels = scaledCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;

      let opaqueIntersection = 0;
      let opaqueUnion = 0;
      let alphaDifference = 0;
      for (let index = 3; index < basePixels.length; index += 4) {
        const baseAlpha = basePixels[index] ?? 0;
        const scaledAlpha = scaledPixels[index] ?? 0;
        const baseOpaque = baseAlpha > 16;
        const scaledOpaque = scaledAlpha > 16;
        if (baseOpaque || scaledOpaque) {
          opaqueUnion += 1;
        }
        if (baseOpaque && scaledOpaque) {
          opaqueIntersection += 1;
        }
        alphaDifference += Math.abs(baseAlpha - scaledAlpha);
      }

      return {
        averageAlphaDifference: alphaDifference / (sampleWidth * sampleHeight),
        opaqueIntersection,
        opaqueUnion,
      };
    });

    expect(result.opaqueUnion).toBeGreaterThan(1400);
    expect(result.opaqueIntersection / result.opaqueUnion).toBeGreaterThan(0.94);
    expect(result.averageAlphaDifference).toBeLessThan(4);
  });

  test('keeps crayon stroke texture density stable when the object scales', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { renderVectorTextureOverlayForObjects } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 340;
      const height = 220;
      const sampleLeft = 48;
      const sampleTop = 92;
      const sampleWidth = 92;
      const sampleHeight = 56;

      const createOverlayContext = () => {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        return overlayCanvas.getContext('2d', { willReadFrequently: true });
      };
      const baseCtx = createOverlayContext();
      const scaledCtx = createOverlayContext();
      if (!baseCtx || !scaledCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const createPathObject = (scale: number) => ({
        type: 'path',
        path: [
          ['M', 0, 0],
          ['L', 120, 0],
        ],
        pathOffset: { x: 0, y: 0 },
        fill: null,
        opacity: 1,
        stroke: 'rgba(37, 99, 235, 0)',
        strokeWidth: 18,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        vectorStrokeBrushId: 'crayon',
        vectorStrokeColor: '#2563eb',
        vectorStrokeOpacity: 1,
        calcTransformMatrix: () => [scale, 0, 0, scale, 56, 120],
      });

      const waitForTextureReady = () => new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        renderVectorTextureOverlayForObjects(baseCtx, [createPathObject(1)], {
          canvasWidth: width,
          canvasHeight: height,
          onTextureSourceReady: done,
        });
        setTimeout(done, 100);
      });

      await waitForTextureReady();
      baseCtx.clearRect(0, 0, width, height);
      scaledCtx.clearRect(0, 0, width, height);

      renderVectorTextureOverlayForObjects(baseCtx, [createPathObject(1)], {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForObjects(scaledCtx, [createPathObject(2)], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const basePixels = baseCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;
      const scaledPixels = scaledCtx.getImageData(sampleLeft, sampleTop, sampleWidth, sampleHeight).data;

      let opaqueIntersection = 0;
      let opaqueUnion = 0;
      let alphaDifference = 0;
      for (let index = 3; index < basePixels.length; index += 4) {
        const baseAlpha = basePixels[index] ?? 0;
        const scaledAlpha = scaledPixels[index] ?? 0;
        const baseOpaque = baseAlpha > 16;
        const scaledOpaque = scaledAlpha > 16;
        if (baseOpaque || scaledOpaque) {
          opaqueUnion += 1;
        }
        if (baseOpaque && scaledOpaque) {
          opaqueIntersection += 1;
        }
        alphaDifference += Math.abs(baseAlpha - scaledAlpha);
      }

      return {
        averageAlphaDifference: alphaDifference / (sampleWidth * sampleHeight),
        opaqueIntersection,
        opaqueUnion,
      };
    });

    expect(result.opaqueUnion).toBeGreaterThan(1200);
    expect(result.opaqueIntersection / result.opaqueUnion).toBeGreaterThan(0.9);
    expect(result.averageAlphaDifference).toBeLessThan(6);
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
        vectorStrokeBrushId: 'crayon',
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
        vectorFillTextureId: 'crayon',
        vectorFillColor: '#22c55e',
        vectorFillOpacity: 1,
        vectorStrokeBrushId: 'crayon',
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
        vectorFillTextureId: 'crayon',
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
            vectorFillTextureId: 'crayon',
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

  test('preserves child stacking for grouped objects that mix textured and solid fills', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const { ActiveSelection, Canvas, Rect } = await import(
        '/@fs/Users/kihaahn/code/0040-pochacoding/node_modules/.pnpm/fabric@7.1.0/node_modules/fabric/dist/index.mjs'
      );
      const { groupActiveCanvasSelection } = await import('/src/components/editors/shared/fabricSelectionCommands.ts');
      const { renderComposedVectorSceneForFabricCanvas } = await import('/src/lib/costume/costumeVectorTextureRenderer.ts');
      const width = 220;
      const height = 220;

      const groupedObjects = [
        new Rect({
          left: 36,
          top: 36,
          width: 132,
          height: 132,
          strokeWidth: 0,
          fill: 'rgba(34, 197, 94, 0)',
          opacity: 1,
          vectorFillTextureId: 'crayon',
          vectorFillColor: '#22c55e',
          vectorFillOpacity: 1,
          vectorStrokeBrushId: 'solid',
          vectorStrokeColor: '#22c55e',
          vectorStrokeOpacity: 1,
        } as any),
        new Rect({
          left: 84,
          top: 84,
          width: 84,
          height: 84,
          strokeWidth: 0,
          fill: '#ef4444',
          opacity: 1,
          vectorFillTextureId: 'solid',
          vectorFillColor: '#ef4444',
          vectorFillOpacity: 1,
          vectorStrokeBrushId: 'solid',
          vectorStrokeColor: '#ef4444',
          vectorStrokeOpacity: 1,
        } as any),
      ];

      const sourceCanvasElement = document.createElement('canvas');
      sourceCanvasElement.width = width;
      sourceCanvasElement.height = height;
      const fabricCanvas = new Canvas(sourceCanvasElement, {
        width,
        height,
        renderOnAddRemove: false,
        enableRetinaScaling: false,
        preserveObjectStacking: true,
      });
      groupedObjects.forEach((object) => fabricCanvas.add(object));
      fabricCanvas.setActiveObject(new ActiveSelection(groupedObjects as any[], { canvas: fabricCanvas }) as any);
      const grouped = groupActiveCanvasSelection(fabricCanvas as any);
      if (!grouped) {
        throw new Error('Failed to group canvas selection.');
      }
      fabricCanvas.renderAll();

      const composedCanvas = document.createElement('canvas');
      composedCanvas.width = width;
      composedCanvas.height = height;
      const composedCtx = composedCanvas.getContext('2d', { willReadFrequently: true });
      if (!composedCtx) {
        throw new Error('Failed to acquire grouped composed vector scene context.');
      }

      try {
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
      } finally {
        fabricCanvas.dispose();
      }
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
          vectorStrokeBrushId: 'crayon',
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
        brushId: 'crayon',
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

  test('wiggle offsets textured dabs along the stroke normal', async ({ page }) => {
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
      const stableCtx = createOverlayContext();
      const wigglyCtx = createOverlayContext();
      if (!stableCtx || !wigglyCtx) {
        throw new Error('Failed to acquire texture overlay context.');
      }

      const createPathObject = (vectorStrokeWiggle: number) => ({
        type: 'path',
        path: [
          ['M', 44, 110],
          ['L', 276, 110],
        ],
        pathOffset: { x: 0, y: 0 },
        fill: null,
        opacity: 1,
        stroke: 'rgba(37, 99, 235, 0)',
        strokeWidth: 20,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        vectorStrokeBrushId: 'crayon',
        vectorStrokeColor: '#2563eb',
        vectorStrokeOpacity: 1,
        vectorStrokeWiggle,
        calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
      });

      renderVectorTextureOverlayForObjects(stableCtx, [createPathObject(0)], {
        canvasWidth: width,
        canvasHeight: height,
      });
      renderVectorTextureOverlayForObjects(wigglyCtx, [createPathObject(1)], {
        canvasWidth: width,
        canvasHeight: height,
      });

      const stablePixels = stableCtx.getImageData(0, 0, width, height).data;
      const wigglyPixels = wigglyCtx.getImageData(0, 0, width, height).data;

      const getOpaqueBounds = (pixels: Uint8ClampedArray) => {
        let minY = height;
        let maxY = -1;
        let count = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          const alpha = pixels[index] ?? 0;
          if (alpha <= 16) {
            continue;
          }
          const pixelIndex = Math.floor(index / 4);
          const y = Math.floor(pixelIndex / width);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          count += 1;
        }
        return {
          count,
          minY,
          maxY,
          height: maxY >= minY ? (maxY - minY) + 1 : 0,
        };
      };

      let opaqueUnion = 0;
      let opaqueIntersection = 0;
      let alphaDifference = 0;
      for (let index = 3; index < stablePixels.length; index += 4) {
        const stableAlpha = stablePixels[index] ?? 0;
        const wigglyAlpha = wigglyPixels[index] ?? 0;
        const stableOpaque = stableAlpha > 16;
        const wigglyOpaque = wigglyAlpha > 16;
        if (stableOpaque || wigglyOpaque) {
          opaqueUnion += 1;
        }
        if (stableOpaque && wigglyOpaque) {
          opaqueIntersection += 1;
        }
        alphaDifference += Math.abs(stableAlpha - wigglyAlpha);
      }

      return {
        stableBounds: getOpaqueBounds(stablePixels),
        wigglyBounds: getOpaqueBounds(wigglyPixels),
        opaqueUnion,
        overlapRatio: opaqueUnion > 0 ? opaqueIntersection / opaqueUnion : 1,
        averageAlphaDifference: alphaDifference / (width * height),
      };
    });

    expect(result.opaqueUnion).toBeGreaterThan(1800);
    expect(result.overlapRatio).toBeLessThan(0.98);
    expect(result.averageAlphaDifference).toBeGreaterThan(0.3);
    expect(result.wigglyBounds.count).toBeGreaterThan(1800);
    expect(result.wigglyBounds.height).toBeGreaterThan(result.stableBounds.height + 6);
  });
});
