import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('background document runtime flattening', () => {
  test('reuses chunk sources for a single opaque layer', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createBitmapBackgroundLayer },
        {
          buildBackgroundConfigFromDocument,
          flattenBackgroundDocumentToChunkData,
          resolveBackgroundRuntimeChunkData,
        },
      ] = await Promise.all([
        import('/src/lib/background/backgroundDocument.ts'),
        import('/src/lib/background/backgroundDocumentRender.ts'),
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to acquire test canvas context.');
      }
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const source = canvas.toDataURL('image/png');

      const layer = createBitmapBackgroundLayer({
        name: 'Layer 1',
        chunks: { '0,0': source },
      });
      const backgroundDocument = {
        version: 1 as const,
        activeLayerId: layer.id,
        chunkSize: 64,
        softChunkLimit: 400,
        hardChunkLimit: 1200,
        layers: [layer],
      };

      const flattened = await flattenBackgroundDocumentToChunkData(backgroundDocument);
      const background = await buildBackgroundConfigFromDocument(backgroundDocument, {
        baseColor: '#000000',
      });
      const runtimeChunks = await resolveBackgroundRuntimeChunkData(background);

      return {
        backgroundType: background.type,
        source,
        flattenedSource: flattened['0,0'] ?? null,
        hasStoredRuntimeChunks: Object.prototype.hasOwnProperty.call(background, 'chunks'),
        runtimeSource: runtimeChunks['0,0'] ?? null,
      };
    });

    expect(result.backgroundType).toBe('tiled');
    expect(result.flattenedSource).toBe(result.source);
    expect(result.runtimeSource).toBe(result.flattenedSource);
    expect(result.hasStoredRuntimeChunks).toBe(false);
  });

  test('merges layered chunk output into one flattened runtime chunk set', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createBitmapBackgroundLayer },
        { flattenBackgroundDocumentToChunkData },
      ] = await Promise.all([
        import('/src/lib/background/backgroundDocument.ts'),
        import('/src/lib/background/backgroundDocumentRender.ts'),
      ]);

      const createSolidChunk = (fillStyle: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to acquire solid chunk context.');
        }
        ctx.fillStyle = fillStyle;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      };

      const bottomSource = createSolidChunk('#ff0000');
      const topSource = createSolidChunk('#0000ff');

      const bottomLayer = createBitmapBackgroundLayer({
        name: 'Bottom',
        chunks: { '0,0': bottomSource },
      });
      const topLayer = createBitmapBackgroundLayer({
        name: 'Top',
        opacity: 0.5,
        chunks: { '0,0': topSource },
      });

      const flattened = await flattenBackgroundDocumentToChunkData({
        version: 1,
        activeLayerId: topLayer.id,
        chunkSize: 64,
        softChunkLimit: 400,
        hardChunkLimit: 1200,
        layers: [bottomLayer, topLayer],
      });

      const output = flattened['0,0'];
      if (!output) {
        throw new Error('Expected a flattened chunk output.');
      }

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error('Failed to decode flattened chunk.'));
        nextImage.src = output;
      });

      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error('Failed to acquire flattened decode context.');
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixel = ctx.getImageData(32, 32, 1, 1).data;

      return {
        flattenedSource: output,
        bottomSource,
        topSource,
        red: pixel[0] ?? 0,
        green: pixel[1] ?? 0,
        blue: pixel[2] ?? 0,
        alpha: pixel[3] ?? 0,
      };
    });

    expect(result.flattenedSource).not.toBe(result.bottomSource);
    expect(result.flattenedSource).not.toBe(result.topSource);
    expect(result.alpha).toBeGreaterThan(0);
    expect(result.red).toBeGreaterThan(100);
    expect(result.blue).toBeGreaterThan(100);
    expect(result.green).toBeLessThan(40);
  });
});
