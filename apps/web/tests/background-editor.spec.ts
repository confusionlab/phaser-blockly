import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function readBackgroundChunkCount(page: Page): Promise<number> {
  const rawValue = await page.getByTestId('background-editor-root').getAttribute('data-chunk-count');
  if (!rawValue) return 0;
  return Number.parseInt(rawValue, 10) || 0;
}

async function readPersistedDarkPixelCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const { resolveBackgroundRuntimeChunkData } = await import('/src/lib/background/backgroundDocumentRender.ts');
    const project = useProjectStore.getState().project;
    const background = project?.scenes[0]?.background;
    if (!background || background.type !== 'tiled') {
      return 0;
    }

    const decodeImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode background chunk image.'));
      image.src = dataUrl;
    });

    let darkPixels = 0;
    const runtimeChunks = await resolveBackgroundRuntimeChunkData(background);
    for (const dataUrl of Object.values(runtimeChunks)) {
      if (!dataUrl) {
        continue;
      }

      const image = await decodeImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        continue;
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] ?? 0;
        if (alpha === 0) {
          continue;
        }

        const red = data[index] ?? 0;
        const green = data[index + 1] ?? 0;
        const blue = data[index + 2] ?? 0;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        if (luminance < 64) {
          darkPixels += 1;
        }
      }
    }

    return darkPixels;
  });
}

async function readBackgroundSelectionGizmoBluePixelCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="background-editor-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let bluePixelCount = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const alpha = data[index + 3] ?? 0;
      if (alpha > 64 && red < 90 && green > 110 && blue > 170) {
        bluePixelCount += 1;
      }
    }

    return bluePixelCount;
  });
}

async function readBackgroundBrushCursorOverlay(page: Page): Promise<{
  cursor: string;
  height: number;
  opacity: number;
  width: number;
}> {
  return await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="background-brush-cursor-overlay"]') as HTMLDivElement | null;
    const canvas = document.querySelector('[data-testid="background-editor-canvas"]') as HTMLCanvasElement | null;
    if (!overlay || !canvas) {
      return {
        cursor: '',
        height: 0,
        opacity: 0,
        width: 0,
      };
    }

    const overlayStyle = window.getComputedStyle(overlay);
    const canvasStyle = window.getComputedStyle(canvas);
    const bounds = overlay.getBoundingClientRect();
    return {
      cursor: canvasStyle.cursor,
      height: bounds.height,
      opacity: Number.parseFloat(overlayStyle.opacity || '0') || 0,
      width: bounds.width,
    };
  });
}

async function readBackgroundDocumentSummary(page: Page): Promise<{
  activeLayerId: string | null;
  bitmapLayerChunkCount: number;
  runtimeChunkCount: number;
  hasTopLevelChunks: boolean;
  layerKinds: string[];
  layerNames: string[];
}> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const { resolveBackgroundRuntimeChunkData } = await import('/src/lib/background/backgroundDocumentRender.ts');
    const project = useProjectStore.getState().project;
    const background = project?.scenes[0]?.background;
    const runtimeChunks = background ? await resolveBackgroundRuntimeChunkData(background) : {};
    const bitmapLayerChunkCount = (background?.document?.layers ?? []).reduce((sum, layer: {
      kind: string;
      bitmap?: { chunks?: Record<string, string> };
    }) => {
      if (layer.kind !== 'bitmap') {
        return sum;
      }
      return sum + Object.keys(layer.bitmap?.chunks ?? {}).length;
    }, 0);
    return {
      activeLayerId: background?.document?.activeLayerId ?? null,
      bitmapLayerChunkCount,
      runtimeChunkCount: Object.keys(runtimeChunks).length,
      hasTopLevelChunks: Object.prototype.hasOwnProperty.call(background ?? {}, 'chunks'),
      layerKinds: (background?.document?.layers ?? []).map((layer: { kind: string }) => layer.kind),
      layerNames: (background?.document?.layers ?? []).map((layer: { name: string }) => layer.name),
    };
  });
}

async function readSavedBackgroundVectorObjectCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const vectorLayer = project?.scenes[0]?.background?.document?.layers?.find(
      (layer: { kind: string }) => layer.kind === 'vector',
    ) as { vector?: { fabricJson?: string } } | undefined;
    if (!vectorLayer?.vector?.fabricJson) {
      return 0;
    }

    try {
      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as { objects?: unknown[] };
      return Array.isArray(parsed.objects) ? parsed.objects.length : 0;
    } catch {
      return -1;
    }
  });
}

async function readSavedBackgroundVectorObjectStyle(page: Page): Promise<{
  fillOpacity: number | null;
  strokeOpacity: number | null;
} | null> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const vectorLayer = project?.scenes[0]?.background?.document?.layers?.find(
      (layer: { kind: string }) => layer.kind === 'vector',
    ) as { vector?: { fabricJson?: string } } | undefined;
    if (!vectorLayer?.vector?.fabricJson) {
      return null;
    }

    try {
      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as {
        objects?: Array<{
          vectorFillOpacity?: unknown;
          vectorStrokeOpacity?: unknown;
        }>;
      };
      const object = Array.isArray(parsed.objects) ? parsed.objects[0] : null;
      if (!object) {
        return null;
      }

      return {
        fillOpacity: typeof object.vectorFillOpacity === 'number' ? object.vectorFillOpacity : null,
        strokeOpacity: typeof object.vectorStrokeOpacity === 'number' ? object.vectorStrokeOpacity : null,
      };
    } catch {
      return null;
    }
  });
}

async function setActiveLayerOpacity(page: Page, opacityPercent: number): Promise<void> {
  await page.locator('[data-testid="layer-row"][aria-pressed="true"]').click({ button: 'right' });
  const slider = page.getByLabel('Layer opacity');
  await expect(slider).toBeVisible();
  await slider.evaluate((input, nextValue) => {
    const slider = input as HTMLInputElement;
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, opacityPercent);
  await page.keyboard.press('Escape');
}

function backgroundLayerRow(page: Page, index: number) {
  return page.locator('[data-testid="layer-row"]').nth(index);
}

async function setToolbarColorOpacity(page: Page, label: 'Fill' | 'Stroke', opacityPercent: number): Promise<void> {
  const button = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await button.click();
  const slider = page.getByTestId('compact-color-picker-opacity');
  await expect(slider).toBeVisible();
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error(`Missing ${label} opacity slider bounds.`);
  }
  const clampedOpacity = Math.max(0, Math.min(100, opacityPercent));

  await slider.click({
    position: {
      x: 12 + ((box.width - 24) * clampedOpacity) / 100,
      y: box.height / 2,
    },
  });
  await button.click();
}

async function addVectorLayer(page: Page): Promise<void> {
  await page.getByTestId('layer-add-button').click();
  await page.getByRole('menuitem', { name: /^vector$/i }).click();
}

async function openBackgroundEditor(page: Page) {
  const sceneRadio = page.getByRole('radio', { name: /^scene$/i });
  await expect(sceneRadio).toBeVisible({ timeout: 10000 });
  await sceneRadio.click();

  const drawButton = page.getByTitle('Draw background').first();
  await expect(drawButton).toBeVisible({ timeout: 10000 });
  await drawButton.click();
  const root = page.getByTestId('background-editor-root');
  await expect(root).toBeVisible();
  const canvas = page.getByTestId('background-editor-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error('Background editor canvas is missing a bounding box.');
  }
  return { root, canvas, box };
}

test.describe('Background editor', () => {
  test('brush and eraser reuse the shared bitmap cursor overlay', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });
    const { box } = await openBackgroundEditor(page);

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.getByRole('button', { name: /^brush$/i }).click();
    await page.mouse.move(centerX, centerY);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).opacity).toBeGreaterThan(0.5);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).width).toBeGreaterThan(0);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).height).toBeGreaterThan(0);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).cursor).toBe('none');

    await page.getByRole('button', { name: /^eraser$/i }).click();
    await page.mouse.move(centerX + 32, centerY + 24);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).opacity).toBeGreaterThan(0.5);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).width).toBeGreaterThan(0);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).height).toBeGreaterThan(0);
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).cursor).toBe('none');

    await page.getByRole('button', { name: /^select$/i }).click();
    await expect.poll(async () => (await readBackgroundBrushCursorOverlay(page)).opacity).toBe(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });

  test('can draw and persist chunked background', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });
    const { root, box } = await openBackgroundEditor(page);

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 20);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(root).toBeHidden();

    const reopened = await openBackgroundEditor(page);
    await expect(reopened.root).toBeVisible();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(reopened.root).toBeHidden();
  });

  test('cancel discards uncommitted edits', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });
    const { root, box } = await openBackgroundEditor(page);

    const chunkCountBefore = await readBackgroundChunkCount(page);
    const startX = box.x + box.width * 0.25;
    const startY = box.y + box.height * 0.4;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 80);
    await page.mouse.up();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(root).toBeHidden();

    const reopened = await openBackgroundEditor(page);
    await expect(reopened.root).toBeVisible();
    const chunkCountAfter = await readBackgroundChunkCount(page);
    expect(chunkCountAfter).toBe(chunkCountBefore);
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });

  test('overlay undo and redo buttons mirror costume canvas controls', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });
    const { box } = await openBackgroundEditor(page);

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });
    await expect(undoButton).toBeDisabled();
    await expect(redoButton).toBeDisabled();

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 20);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    await expect(undoButton).toBeEnabled();
    await expect(redoButton).toBeDisabled();

    await undoButton.click();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBe(0);
    await expect(redoButton).toBeEnabled();

    await redoButton.click();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });

  test('keeps explicit bitmap and vector layers in the saved background document', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });
    const { canvas, box } = await openBackgroundEditor(page);

    const startX = box.x + box.width * 0.28;
    const startY = box.y + box.height * 0.42;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 90, startY + 35);
    await page.mouse.up();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);

    await addVectorLayer(page);
    const vectorLayerButton = backgroundLayerRow(page, 0);
    await expect(vectorLayerButton).toHaveAttribute('data-layer-kind', 'vector');
    await expect(vectorLayerButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.34);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.73, box.y + box.height * 0.5);
    await page.mouse.up();

    await canvas.click({ position: { x: Math.round(box.width * 0.62), y: Math.round(box.height * 0.41) } });
    await expect(vectorLayerButton).toHaveAttribute('aria-pressed', 'true');
    const bitmapLayerButton = backgroundLayerRow(page, 1);
    await expect(bitmapLayerButton).toHaveAttribute('data-layer-kind', 'bitmap');
    await bitmapLayerButton.click();
    await expect(bitmapLayerButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(page.getByTestId('background-editor-root')).toBeHidden();

    const summary = await readBackgroundDocumentSummary(page);
    expect(summary.layerKinds).toEqual(['bitmap', 'vector']);
    expect(summary.layerNames).toEqual(['Layer 1', 'Layer 2']);
    expect(summary.activeLayerId).not.toBeNull();
    expect(summary.bitmapLayerChunkCount).toBeGreaterThan(0);
    expect(summary.runtimeChunkCount).toBeGreaterThan(0);
    expect(summary.hasTopLevelChunks).toBe(false);

    const reopened = await openBackgroundEditor(page);
    await expect(page.locator('[data-testid="layer-row"][data-layer-kind="bitmap"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="layer-row"][data-layer-kind="vector"]')).toHaveCount(1);
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(reopened.root).toBeHidden();
  });

  test('vector undo and redo round-trip through the saved background document', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    let editor = await openBackgroundEditor(page);
    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await page.mouse.move(editor.box.x + editor.box.width * 0.55, editor.box.y + editor.box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(editor.box.x + editor.box.width * 0.74, editor.box.y + editor.box.height * 0.54);
    await page.mouse.up();

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });
    await expect(undoButton).toBeEnabled();
    await undoButton.click();
    await expect(redoButton).toBeEnabled();
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(editor.root).toBeHidden();
    await expect.poll(async () => readSavedBackgroundVectorObjectCount(page)).toBe(0);

    editor = await openBackgroundEditor(page);
    const vectorLayerButton = backgroundLayerRow(page, 0);
    await vectorLayerButton.click();
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await page.mouse.move(editor.box.x + editor.box.width * 0.48, editor.box.y + editor.box.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(editor.box.x + editor.box.width * 0.68, editor.box.y + editor.box.height * 0.58);
    await page.mouse.up();

    await expect(undoButton).toBeEnabled();
    await undoButton.click();
    await expect(redoButton).toBeEnabled();
    await redoButton.click();
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(editor.root).toBeHidden();
    await expect.poll(async () => readSavedBackgroundVectorObjectCount(page)).toBe(1);
  });

  test('vector pen and text tools persist through the saved background document', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    const editor = await openBackgroundEditor(page);
    await addVectorLayer(page);
    const vectorCanvas = page.getByTestId('background-vector-layer-canvas');
    await expect(vectorCanvas).toBeVisible();

    await page.getByRole('button', { name: /^pen$/i }).click();
    await vectorCanvas.click({
      position: { x: Math.round(editor.box.width * 0.42), y: Math.round(editor.box.height * 0.36) },
    });
    await vectorCanvas.click({
      position: { x: Math.round(editor.box.width * 0.54), y: Math.round(editor.box.height * 0.44) },
    });
    await vectorCanvas.click({
      position: { x: Math.round(editor.box.width * 0.48), y: Math.round(editor.box.height * 0.58) },
    });
    await page.keyboard.press('Enter');

    await page.getByRole('button', { name: /^text$/i }).click();
    await vectorCanvas.click({
      position: { x: Math.round(editor.box.width * 0.64), y: Math.round(editor.box.height * 0.5) },
    });
    await page.keyboard.type('BG');
    await page.getByRole('button', { name: /^select$/i }).click();

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(editor.root).toBeHidden();
    await expect.poll(async () => readSavedBackgroundVectorObjectCount(page)).toBe(2);
  });

  test('vector point editing uses the shared costume handle controls', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    const editor = await openBackgroundEditor(page);
    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();

    const startX = editor.box.x + editor.box.width * 0.42;
    const startY = editor.box.y + editor.box.height * 0.42;
    const endX = editor.box.x + editor.box.width * 0.58;
    const endY = editor.box.y + editor.box.height * 0.58;
    const centerX = (startX + endX) / 2;
    const centerY = (startY + endY) / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();

    await page.getByRole('button', { name: /^select$/i }).click();
    await page.mouse.dblclick(centerX, centerY);
    await page.mouse.click(startX, startY);

    await expect(page.getByText('Handles')).toBeVisible();
  });

  test('vector selection enables the shared align and zoom-to-selection controls', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    const editor = await openBackgroundEditor(page);
    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();

    const startX = editor.box.x + editor.box.width * 0.38;
    const startY = editor.box.y + editor.box.height * 0.38;
    const endX = editor.box.x + editor.box.width * 0.48;
    const endY = editor.box.y + editor.box.height * 0.5;
    const centerX = (startX + endX) / 2;
    const centerY = (startY + endY) / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();

    await page.getByRole('button', { name: /^select$/i }).click();
    await page.getByTestId('background-vector-layer-canvas').click({
      position: {
        x: Math.round(centerX - editor.box.x),
        y: Math.round(centerY - editor.box.y),
      },
    });

    await expect(page.getByRole('button', { name: /^align$/i })).toBeEnabled();

    const zoomButton = page.getByRole('button', { name: 'Zoom options' });
    const initialZoomText = (await zoomButton.textContent())?.trim() ?? '';
    await zoomButton.click();
    const zoomToSelection = page.getByRole('menuitem', { name: /zoom to selection/i });
    await expect(zoomToSelection).toBeEnabled();
    await zoomToSelection.click();
    await expect(zoomButton).not.toContainText(initialZoomText);
  });

  test('selected vector shapes keep fill and stroke opacity independent', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    const editor = await openBackgroundEditor(page);
    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await setToolbarColorOpacity(page, 'Fill', 60);
    await setToolbarColorOpacity(page, 'Stroke', 85);

    await page.mouse.move(editor.box.x + editor.box.width * 0.52, editor.box.y + editor.box.height * 0.34);
    await page.mouse.down();
    await page.mouse.move(editor.box.x + editor.box.width * 0.72, editor.box.y + editor.box.height * 0.56);
    await page.mouse.up();

    await page.getByRole('button', { name: /^select$/i }).click();
    await page.getByTestId('background-vector-layer-canvas').click({
      position: { x: Math.round(editor.box.width * 0.62), y: Math.round(editor.box.height * 0.44) },
    });
    await setToolbarColorOpacity(page, 'Fill', 20);

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(editor.root).toBeHidden();

    await expect.poll(async () => readSavedBackgroundVectorObjectStyle(page), { timeout: 10000 }).toMatchObject({
      fillOpacity: expect.any(Number),
      strokeOpacity: expect.any(Number),
    });

    const style = await readSavedBackgroundVectorObjectStyle(page);
    expect(style).not.toBeNull();
    expect(style?.fillOpacity).toBeLessThan(0.35);
    expect(style?.strokeOpacity).toBeGreaterThan(0.75);
    expect(style?.strokeOpacity).toBeGreaterThan((style?.fillOpacity ?? 0) + 0.3);
  });

  test('recovers from malformed saved vector documents and keeps them editable', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    await page.evaluate(async () => {
      const [
        { useProjectStore },
        { buildBackgroundConfigFromDocument },
        { createBlankBackgroundDocument, createVectorBackgroundLayer },
      ] = await Promise.all([
        import('/src/store/projectStore.ts'),
        import('/src/lib/background/backgroundDocumentRender.ts'),
        import('/src/lib/background/backgroundDocument.ts'),
      ]);

      const store = useProjectStore.getState();
      const scene = store.project?.scenes[0];
      if (!scene) {
        throw new Error('Missing scene for malformed vector background test.');
      }

      const document = createBlankBackgroundDocument();
      const brokenVectorLayer = createVectorBackgroundLayer({
        name: 'Broken Vector',
        fabricJson: '{',
      });
      const nextDocument = {
        ...document,
        activeLayerId: brokenVectorLayer.id,
        layers: [
          document.layers[0],
          brokenVectorLayer,
        ],
      };

      const background = await buildBackgroundConfigFromDocument(nextDocument, {
        baseColor: '#87CEEB',
        scrollFactor: scene.background?.scrollFactor,
      });

      store.updateScene(scene.id, { background });
    });

    const { root, box } = await openBackgroundEditor(page);
    await expect(backgroundLayerRow(page, 0)).toHaveAttribute('data-layer-kind', 'vector');
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await page.mouse.move(box.x + box.width * 0.54, box.y + box.height * 0.36);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.52);
    await page.mouse.up();

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(root).toBeHidden();
    await expect.poll(async () => readSavedBackgroundVectorObjectCount(page)).toBe(1);
  });
});

test.describe('Background editor high-DPI selection rendering', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  test('committing a floating selection preserves persisted background scale', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    const { box } = await openBackgroundEditor(page);
    const startX = box.x + box.width * 0.45;
    const startY = box.y + box.height * 0.45;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + box.width * 0.08, startY + box.height * 0.06);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(page.getByTestId('background-editor-root')).toBeHidden();

    const baselineDarkPixels = await readPersistedDarkPixelCount(page);
    expect(baselineDarkPixels).toBeGreaterThan(0);

    const reopened = await openBackgroundEditor(page);
    await reopened.canvas.click();
    await page.keyboard.press('v');
    await page.mouse.move(reopened.box.x + reopened.box.width * 0.35, reopened.box.y + reopened.box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(reopened.box.x + reopened.box.width * 0.65, reopened.box.y + reopened.box.height * 0.65);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundSelectionGizmoBluePixelCount(page), { timeout: 5000 }).toBeGreaterThan(200);
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(page.getByTestId('background-editor-root')).toBeHidden();

    const nextDarkPixels = await readPersistedDarkPixelCount(page);
    expect(nextDarkPixels).toBeGreaterThan(0);
    expect(nextDarkPixels).toBeGreaterThan(Math.floor(baselineDarkPixels * 0.75));
    expect(nextDarkPixels).toBeLessThan(Math.ceil(baselineDarkPixels * 1.25));
  });

  test('layer opacity changes do not discard floating bitmap selections', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Background Test ${Date.now()}` });

    const initialEditor = await openBackgroundEditor(page);
    const startX = initialEditor.box.x + initialEditor.box.width * 0.42;
    const startY = initialEditor.box.y + initialEditor.box.height * 0.42;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + initialEditor.box.width * 0.1, startY + initialEditor.box.height * 0.08);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(initialEditor.root).toBeHidden();

    const baselineDarkPixels = await readPersistedDarkPixelCount(page);
    expect(baselineDarkPixels).toBeGreaterThan(0);

    const reopened = await openBackgroundEditor(page);
    await page.keyboard.press('v');
    await page.mouse.move(reopened.box.x + reopened.box.width * 0.34, reopened.box.y + reopened.box.height * 0.34);
    await page.mouse.down();
    await page.mouse.move(reopened.box.x + reopened.box.width * 0.66, reopened.box.y + reopened.box.height * 0.66);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundSelectionGizmoBluePixelCount(page), { timeout: 5000 }).toBeGreaterThan(200);
    await setActiveLayerOpacity(page, 60);
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(reopened.root).toBeHidden();

    const nextDarkPixels = await readPersistedDarkPixelCount(page);
    expect(nextDarkPixels).toBeGreaterThan(0);
    expect(nextDarkPixels).toBeGreaterThan(Math.floor(baselineDarkPixels * 0.75));
    expect(nextDarkPixels).toBeLessThan(Math.ceil(baselineDarkPixels * 1.25));
  });
});
