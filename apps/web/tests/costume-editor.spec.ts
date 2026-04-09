import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

const COSTUME_EDITOR_TEST_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

async function openEditorFromProjectList(page: Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Costume Test ${Date.now()}` });
}

async function openCostumeEditor(page: Page): Promise<void> {
  await openEditorFromProjectList(page);

  await page.getByRole('button', { name: /add object/i }).click();
  const costumeTab = page.getByRole('radio', { name: /^costumes?$/i });
  await expect(costumeTab).toBeVisible({ timeout: 10000 });
  await costumeTab.click();

  await expect(page.getByTestId('layer-add-button')).toBeVisible({ timeout: 10000 });
  await waitForCostumeCanvasReady(page);
}

async function addVectorLayer(page: Page): Promise<void> {
  await page.getByTestId('layer-add-button').click();
  await page.getByRole('menuitem', { name: /^vector$/i }).click();
  await page.locator('[data-testid="layer-row"][data-layer-kind="vector"]').last().click();
}

async function addBitmapLayer(page: Page): Promise<void> {
  await page.getByTestId('layer-add-button').click();
  await page.getByRole('menuitem', { name: /^pixel$/i }).click();
}

async function getCostumeCanvasBox(page: Page) {
  const canvasSurface = page.getByTestId('costume-canvas-surface');
  await expect(canvasSurface).toBeVisible();
  const box = await canvasSurface.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error('Costume canvas surface is missing a bounding box.');
  }
  return box;
}

async function drawAcrossCostumeCanvas(page: Page, startXFactor: number, startYFactor: number, endXFactor: number, endYFactor: number) {
  const box = await getCostumeCanvasBox(page);
  const startX = box.x + box.width * startXFactor;
  const startY = box.y + box.height * startYFactor;
  const endX = box.x + box.width * endXFactor;
  const endY = box.y + box.height * endYFactor;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
}

async function selectBitmapBrushKind(page: Page, label: 'Hard' | 'Soft' | 'Crayon') {
  await page.getByRole('button', { name: /^(Hard|Soft|Crayon)$/i }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${label}$`, 'i') }).click();
}

async function setBrushColorOpacity(page: Page, opacityPercent: number): Promise<void> {
  const colorButton = page.getByTestId('costume-toolbar-properties').getByRole('button', { name: /^color$/i });
  await colorButton.click();
  const slider = page.getByTestId('compact-color-picker-opacity').getByRole('slider');
  await expect(slider).toBeVisible();
  await slider.focus();

  const targetOpacity = Math.max(0, Math.min(100, Math.round(opacityPercent)));
  if (targetOpacity <= 50) {
    await slider.press('Home');
    for (let index = 0; index < targetOpacity; index += 1) {
      await slider.press('ArrowRight');
    }
  } else {
    await slider.press('End');
    for (let index = targetOpacity; index < 100; index += 1) {
      await slider.press('ArrowLeft');
    }
  }
  await expect(slider).toHaveAttribute('aria-valuenow', String(targetOpacity));
  await colorButton.click();
}

async function previewRangeSliderValueWithoutCommit(
  page: Page,
  slider: Locator,
  value: number,
  options?: { overshootPx?: number },
): Promise<void> {
  const pointerPath = await slider.evaluate((element, payload) => {
    const sliderElement = element as HTMLElement;
    const min = Number(sliderElement.getAttribute('aria-valuemin') ?? '0');
    const max = Number(sliderElement.getAttribute('aria-valuemax') ?? '100');
    const currentValue = Number(sliderElement.getAttribute('aria-valuenow') ?? String(min));
    const rect = sliderElement.getBoundingClientRect();
    const clampedTarget = Math.max(min, Math.min(max, Number(payload.targetValue)));
    const range = max - min;
    const getClientX = (nextValue: number) => {
      if (range <= 0) {
        return rect.left + rect.width / 2;
      }
      return rect.left + ((nextValue - min) / range) * rect.width;
    };
    const clientY = rect.top + rect.height / 2;
    return {
      startX: getClientX(currentValue),
      endX: getClientX(clampedTarget) + (payload.overshootPx ?? 0),
      clientY,
    };
  }, {
    targetValue: value,
    overshootPx: options?.overshootPx ?? 0,
  });

  await page.mouse.move(pointerPath.startX, pointerPath.clientY);
  await page.mouse.down();
  await page.mouse.move(pointerPath.endX, pointerPath.clientY, { steps: 8 });
  await page.waitForTimeout(250);
}

async function commitRangeSliderValue(page: Page): Promise<void> {
  await page.mouse.up();
}

async function clickCostumeCanvas(page: Page, xFactor: number, yFactor: number) {
  const box = await getCostumeCanvasBox(page);
  const targetX = box.x + box.width * xFactor;
  const targetY = box.y + box.height * yFactor;
  await page.mouse.move(targetX, targetY);
  await page.mouse.down();
  await page.mouse.up();
}

async function doubleClickCostumeCanvas(page: Page, xFactor: number, yFactor: number) {
  const box = await getCostumeCanvasBox(page);
  await page.mouse.dblclick(
    box.x + box.width * xFactor,
    box.y + box.height * yFactor,
  );
}

async function openCostumeVectorContextMenu(page: Page, xFactor: number, yFactor: number): Promise<void> {
  const canvasSurface = page.getByTestId('costume-canvas-surface');
  const box = await getCostumeCanvasBox(page);
  await canvasSurface.click({
    button: 'right',
    position: {
      x: box.width * xFactor,
      y: box.height * yFactor,
    },
  });
  await expect(page.getByTestId('vector-selection-context-menu')).toBeVisible();
}

async function expectVectorContextMenuOrder(page: Page): Promise<void> {
  const labels = await page.getByTestId('vector-selection-context-menu').getByRole('button').allTextContents();
  expect(labels.map((label) => label.trim())).toEqual(['Copy', 'Cut', 'Paste', 'Duplicate', 'Delete']);
}

async function readCostumeActiveLayerCursor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="costume-active-layer-host"] .upper-canvas')
      ?? document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
    return canvas instanceof HTMLCanvasElement ? canvas.style.cursor : '';
  });
}

async function expectLayerThumbnail(button: Locator): Promise<void> {
  const thumbnailImage = button.getByTestId('costume-layer-thumbnail').locator('img');
  await expect.poll(async () => {
    if (await thumbnailImage.count() === 0) {
      return '';
    }
    return await thumbnailImage.first().getAttribute('src');
  }, { timeout: 10000 }).toMatch(/^data:image\/png;base64,/);
}

async function readLayerThumbnailSrc(button: Locator): Promise<string | null> {
  const thumbnailImage = button.getByTestId('costume-layer-thumbnail').locator('img');
  if (await thumbnailImage.count() === 0) {
    return null;
  }
  return await thumbnailImage.first().getAttribute('src');
}

async function startLayerThumbnailVisibilityObserver(button: Locator, observerKey: string): Promise<void> {
  await button.evaluate((element, key) => {
    const thumbnail = element.querySelector('[data-testid="costume-layer-thumbnail"]');
    if (!(thumbnail instanceof HTMLElement)) {
      throw new Error('Layer thumbnail container not found.');
    }

    const store = ((window as any).__costumeLayerThumbnailObservers ??= {});
    const entry: { observer?: MutationObserver; sawMissing: boolean } = {
      sawMissing: !thumbnail.querySelector('img'),
    };
    const observer = new MutationObserver(() => {
      entry.sawMissing = entry.sawMissing || !thumbnail.querySelector('img');
    });
    observer.observe(thumbnail, {
      childList: true,
      subtree: true,
    });
    entry.observer = observer;
    store[key] = entry;
  }, observerKey);
}

async function stopLayerThumbnailVisibilityObserver(button: Locator, observerKey: string): Promise<boolean> {
  return await button.evaluate((element, key) => {
    const store = (window as any).__costumeLayerThumbnailObservers ?? {};
    const entry = store[key] as { observer?: MutationObserver; sawMissing?: boolean } | undefined;
    entry?.observer?.disconnect();
    delete store[key];

    const thumbnail = element.querySelector('[data-testid="costume-layer-thumbnail"]');
    const isMissingNow = thumbnail instanceof HTMLElement
      ? !thumbnail.querySelector('img')
      : true;
    return Boolean(entry?.sawMissing) || isMissingNow;
  }, observerKey);
}

async function readLayerPanelWidth(page: Page): Promise<number> {
  return await page.getByTestId('layer-panel').evaluate((element) => {
    return Math.round((element as HTMLElement).getBoundingClientRect().width);
  });
}

async function readActiveCostumeLayerOpacity(page: Page): Promise<number | null> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project as {
      scenes?: Array<{
        objects?: Array<{
          currentCostumeIndex?: number;
          costumes?: Array<{
            document?: {
              activeLayerId?: string;
              layers?: Array<{ id: string; opacity?: number }>;
            };
          }>;
        }>;
      }>;
    } | null;

    const object = project?.scenes?.[0]?.objects?.[0];
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const activeLayerId = costume?.document?.activeLayerId;
    const activeLayer = costume?.document?.layers?.find((layer) => layer.id === activeLayerId);
    return typeof activeLayer?.opacity === 'number' ? activeLayer.opacity : null;
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

async function startLayerSelectionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const readButtons = () => Array.from(
      document.querySelectorAll('[data-testid="layer-row"][aria-pressed]'),
    ).map((button) => ({
      label: button.getAttribute('aria-label') ?? button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      pressed: button.getAttribute('aria-pressed') === 'true',
    }));

    const previousObserver = (window as typeof window & {
      __costumeLayerSelectionObserver?: MutationObserver;
    }).__costumeLayerSelectionObserver;
    previousObserver?.disconnect();

    (window as typeof window & {
      __costumeLayerSelectionTimeline?: Array<Array<{ label: string; pressed: boolean }>>;
    }).__costumeLayerSelectionTimeline = [readButtons()];

    const observer = new MutationObserver(() => {
      (window as typeof window & {
        __costumeLayerSelectionTimeline?: Array<Array<{ label: string; pressed: boolean }>>;
      }).__costumeLayerSelectionTimeline?.push(readButtons());
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
    (window as typeof window & {
      __costumeLayerSelectionObserver?: MutationObserver;
    }).__costumeLayerSelectionObserver = observer;
  });
}

async function stopLayerSelectionObserver(page: Page) {
  return await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __costumeLayerSelectionObserver?: MutationObserver;
      __costumeLayerSelectionTimeline?: Array<Array<{ label: string; pressed: boolean }>>;
    };
    runtimeWindow.__costumeLayerSelectionObserver?.disconnect();
    delete runtimeWindow.__costumeLayerSelectionObserver;
    return runtimeWindow.__costumeLayerSelectionTimeline ?? [];
  });
}

async function waitForCostumeCanvasReady(page: Page): Promise<void> {
  const activeLayerVisual = page.getByTestId('costume-active-layer-visual');
  await expect(activeLayerVisual).toBeVisible({ timeout: 10000 });
  await expect(activeLayerVisual).toHaveAttribute('data-host-ready', 'true', { timeout: 10000 });
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const host = document.querySelector('[data-testid="costume-active-layer-host"]');
      if (!(host instanceof HTMLElement)) {
        return false;
      }

      const fabricCanvas = host.querySelector('canvas');
      return fabricCanvas instanceof HTMLCanvasElement && fabricCanvas.width > 0 && fabricCanvas.height > 0;
    });
  }, { timeout: 10000 }).toBe(true);
}

async function expectLocatorToBeTopmost(locator: Locator): Promise<void> {
  await expect.poll(async () => (
    locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const probeX = rect.left + Math.min(rect.width / 2, 48);
      const probeY = rect.top + Math.min(rect.height / 2, 32);
      const topElement = document.elementFromPoint(probeX, probeY);
      return !!topElement && (topElement === element || element.contains(topElement));
    })
  )).toBe(true);
}

async function readNearestStackingZIndex(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    let current: HTMLElement | null = element as HTMLElement;
    while (current) {
      const zIndex = getComputedStyle(current).zIndex;
      if (zIndex && zIndex !== 'auto') {
        return Number.parseInt(zIndex, 10) || 0;
      }
      current = current.parentElement;
    }
    return 0;
  });
}

async function roundTripThroughCodeTab(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /^code$/i }).click();
  await page.getByRole('radio', { name: /^costumes?$/i }).click();
  await waitForCostumeCanvasReady(page);
}

async function readCheckerboardInkSamples(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('[data-testid="costume-canvas-surface"] canvas')) as HTMLCanvasElement[];
    let opaqueSamples = 0;

    for (const canvas of canvases) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        continue;
      }

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 3; index < data.length; index += 4 * 97) {
        if ((data[index] ?? 0) > 0) {
          opaqueSamples += 1;
        }
      }
    }

    return opaqueSamples;
  });
}

async function readCostumeSelectionGizmoBluePixelCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const overlayCanvas = document.querySelector('[data-testid="costume-vector-guide-overlay"]');
    if (!(overlayCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    let bluePixelCount = 0;
    const ctx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const imageData = ctx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      const alpha = imageData.data[index + 3];
      if (alpha > 64 && red < 90 && green > 110 && blue > 170) {
        bluePixelCount += 1;
      }
    }

    return bluePixelCount;
  });
}

async function readCostumeOverlayBluePixelCountInCanvasRegion(
  page: Page,
  region: { xFactor: number; yFactor: number; widthFactor: number; heightFactor: number },
): Promise<number> {
  return await page.evaluate((targetRegion) => {
    const overlayCanvas = document.querySelector('[data-testid="costume-vector-guide-overlay"]');
    const costumeSurface = document.querySelector('[data-testid="costume-canvas-surface"]');
    if (!(overlayCanvas instanceof HTMLCanvasElement) || !(costumeSurface instanceof HTMLElement)) {
      return 0;
    }

    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    if (!overlayCtx) {
      return 0;
    }

    const overlayRect = overlayCanvas.getBoundingClientRect();
    const surfaceRect = costumeSurface.getBoundingClientRect();
    if (overlayRect.width <= 0 || overlayRect.height <= 0 || surfaceRect.width <= 0 || surfaceRect.height <= 0) {
      return 0;
    }

    const leftCss = surfaceRect.left + surfaceRect.width * targetRegion.xFactor;
    const topCss = surfaceRect.top + surfaceRect.height * targetRegion.yFactor;
    const widthCss = surfaceRect.width * targetRegion.widthFactor;
    const heightCss = surfaceRect.height * targetRegion.heightFactor;

    const left = Math.max(0, Math.floor((leftCss - overlayRect.left) * (overlayCanvas.width / overlayRect.width)));
    const top = Math.max(0, Math.floor((topCss - overlayRect.top) * (overlayCanvas.height / overlayRect.height)));
    const width = Math.max(1, Math.ceil(widthCss * (overlayCanvas.width / overlayRect.width)));
    const height = Math.max(1, Math.ceil(heightCss * (overlayCanvas.height / overlayRect.height)));
    const clampedWidth = Math.min(width, overlayCanvas.width - left);
    const clampedHeight = Math.min(height, overlayCanvas.height - top);
    if (clampedWidth <= 0 || clampedHeight <= 0) {
      return 0;
    }

    const { data } = overlayCtx.getImageData(left, top, clampedWidth, clampedHeight);
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
  }, region);
}

async function readCostumeOverlayTopEdgeThickness(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const overlayCanvas = document.querySelector('[data-testid="costume-vector-guide-overlay"]');
    if (!(overlayCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    if (!overlayCtx) {
      return 0;
    }

    const imageData = overlayCtx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height);
    const { data, width, height } = imageData;
    const isBluePixel = (x: number, y: number) => {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const alpha = data[index + 3] ?? 0;
      return alpha > 64 && red < 90 && green > 110 && blue > 170;
    };

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isBluePixel(x, y)) {
          continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) {
      return 0;
    }

    const sampleX = Math.max(minX, Math.min(maxX, Math.round((minX + maxX) / 2)));
    let thickness = 0;
    let started = false;
    for (let y = minY; y <= Math.min(maxY, minY + 24); y += 1) {
      if (isBluePixel(sampleX, y)) {
        thickness += 1;
        started = true;
        continue;
      }
      if (started) {
        break;
      }
    }

    return thickness;
  });
}

async function readOverlayOpaqueSampleCount(page: Page, selector: string): Promise<number> {
  return await page.evaluate((targetSelector) => {
    const canvas = document.querySelector(targetSelector);
    if (!(canvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let opaqueSamples = 0;
    for (let index = 3; index < data.length; index += 4 * 43) {
      if ((data[index] ?? 0) > 0) {
        opaqueSamples += 1;
      }
    }
    return opaqueSamples;
  }, selector);
}

async function readCostumeEditorCompositePixel(
  page: Page,
  sample: { x: number; y: number },
): Promise<{ r: number; g: number; b: number; a: number } | null> {
  return await page.evaluate(({ sample }) => {
    const surface = document.querySelector('[data-testid="costume-canvas-surface"]');
    if (!(surface instanceof HTMLElement)) {
      return null;
    }

    const width = Math.max(1, Math.round(surface.clientWidth));
    const height = Math.max(1, Math.round(surface.clientHeight));
    const probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }

    const canvases = Array.from(surface.querySelectorAll('canvas'));
    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement)) {
        continue;
      }
      const style = window.getComputedStyle(canvas);
      if (style.visibility === 'hidden' || style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0) {
        continue;
      }
      ctx.drawImage(canvas, 0, 0, width, height);
    }

    const px = Math.max(0, Math.min(width - 1, Math.round(sample.x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(sample.y)));
    const data = ctx.getImageData(px, py, 1, 1).data;
    return {
      r: data[0] ?? 0,
      g: data[1] ?? 0,
      b: data[2] ?? 0,
      a: data[3] ?? 0,
    };
  }, { sample });
}

async function readSavedCostumeGroupedChildFillColors(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const object = project?.scenes?.[0]?.objects?.[0];
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
    if (!vectorLayer?.vector?.fabricJson) {
      return [];
    }

    try {
      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as {
        objects?: Array<{ objects?: Array<{ vectorFillColor?: string; fill?: string }> }>;
      };
      const [group] = Array.isArray(parsed.objects) ? parsed.objects : [];
      return Array.isArray(group?.objects)
        ? group.objects.map((child) => String(child?.vectorFillColor ?? child?.fill ?? '')).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  });
}

async function readSavedCostumeGroupedChildTypes(page: Page): Promise<{
  topLevelCount: number;
  childTypes: string[];
}> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const object = project?.scenes?.[0]?.objects?.[0];
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
    if (!vectorLayer?.vector?.fabricJson) {
      return { topLevelCount: 0, childTypes: [] };
    }

    try {
      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as {
        objects?: Array<{ type?: string; objects?: Array<{ type?: string }> }>;
      };
      const rootObjects = Array.isArray(parsed.objects) ? parsed.objects : [];
      const [group] = rootObjects;
      return {
        topLevelCount: rootObjects.length,
        childTypes: Array.isArray(group?.objects)
          ? group.objects.map((child) => String(child?.type ?? '').trim().toLowerCase())
          : [],
      };
    } catch {
      return { topLevelCount: -1, childTypes: [] };
    }
  });
}

async function setVectorStrokeBrush(page: Page, label: 'Crayon') {
  const properties = page.getByTestId('costume-toolbar-properties');
  await properties.getByRole('button', { name: /^solid$/i }).first().click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${label}$`, 'i') }).click();
}

async function readHostedLayerInkSamples(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hostedCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
    if (!(hostedCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = hostedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, hostedCanvas.width, hostedCanvas.height);
    let opaqueSamples = 0;
    for (let index = 3; index < data.length; index += 4 * 193) {
      if ((data[index] ?? 0) > 0) {
        opaqueSamples += 1;
      }
    }

    return opaqueSamples;
  });
}

async function readHostedLayerMaxAlpha(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hostedCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
    if (!(hostedCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = hostedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, hostedCanvas.width, hostedCanvas.height);
    let maxAlpha = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index] ?? 0;
      if (alpha > maxAlpha) {
        maxAlpha = alpha;
      }
    }

    return maxAlpha;
  });
}

async function readPreviewLayerMaxAlpha(page: Page): Promise<number> {
  return page.evaluate(() => {
    const previewCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .upper-canvas');
    if (!(previewCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    let maxAlpha = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index] ?? 0;
      if (alpha > maxAlpha) {
        maxAlpha = alpha;
      }
    }

    return maxAlpha;
  });
}

async function observeVisibleHostedLayerInkTimeline(page: Page, frameCount = 36): Promise<number[]> {
  return await page.evaluate((frames) => {
    return new Promise<number[]>((resolve) => {
      const lowerCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
      const upperCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .upper-canvas');
      if (!(lowerCanvas instanceof HTMLCanvasElement)) {
        resolve([]);
        return;
      }

      const sampleCanvas = (canvas: HTMLCanvasElement | null): number => {
        if (!canvas) {
          return 0;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return 0;
        }

        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let opaqueSamples = 0;
        for (let index = 3; index < data.length; index += 4 * 193) {
          if ((data[index] ?? 0) > 0) {
            opaqueSamples += 1;
          }
        }
        return opaqueSamples;
      };

      const timeline: number[] = [];
      const captureFrame = () => {
        const lowerHidden = lowerCanvas.style.opacity === '0';
        const visibleCanvas = lowerHidden && upperCanvas instanceof HTMLCanvasElement
          ? upperCanvas
          : lowerCanvas;
        timeline.push(sampleCanvas(visibleCanvas));
        if (timeline.length >= frames) {
          resolve(timeline);
          return;
        }
        window.requestAnimationFrame(captureFrame);
      };

      window.requestAnimationFrame(captureFrame);
    });
  }, frameCount);
}

async function readCurrentCostumeDocumentSignature(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const scene = project?.scenes?.[0];
    const object = scene?.objects?.[0];
    const currentCostumeIndex = object?.currentCostumeIndex ?? 0;
    const document = object?.costumes?.[currentCostumeIndex]?.document;
    return document ? JSON.stringify(document) : null;
  });
}

async function readObjectCurrentCostumeVectorObjectCount(page: Page, objectName: string): Promise<number> {
  return await page.evaluate(async ({ objectName }) => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const object = project?.scenes?.[0]?.objects?.find((candidate) => candidate.name === objectName);
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const vectorLayers = costume?.document?.layers?.filter((layer) => layer.kind === 'vector') ?? [];

    return vectorLayers.reduce((count, layer) => {
      try {
        const parsed = JSON.parse(layer.vector.fabricJson) as { objects?: unknown[] };
        return count + (Array.isArray(parsed.objects) ? parsed.objects.length : 0);
      } catch {
        return count;
      }
    }, 0);
  }, { objectName });
}

async function readObjectCurrentCostumeVectorObjectPosition(
  page: Page,
  objectName: string,
): Promise<{ left: number | null; top: number | null } | null> {
  return await page.evaluate(async ({ objectName }) => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const object = project?.scenes?.[0]?.objects?.find((candidate) => candidate.name === objectName);
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
    if (!vectorLayer) {
      return null;
    }

    try {
      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as {
        objects?: Array<{ left?: unknown; top?: unknown }>;
      };
      const entry = Array.isArray(parsed.objects) ? parsed.objects[0] : null;
      if (!entry) {
        return null;
      }
      return {
        left: typeof entry.left === 'number' ? entry.left : null,
        top: typeof entry.top === 'number' ? entry.top : null,
      };
    } catch {
      return null;
    }
  }, { objectName });
}

async function readCurrentCostumeTextFontSize(page: Page): Promise<number | null> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const scene = project?.scenes?.[0];
    const object = scene?.objects?.[0];
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
    if (!vectorLayer?.vector?.fabricJson) {
      return null;
    }

    try {
      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as {
        objects?: Array<{ fontSize?: unknown }>;
      };
      const entry = Array.isArray(parsed.objects) ? parsed.objects[0] : null;
      return typeof entry?.fontSize === 'number' ? entry.fontSize : null;
    } catch {
      return null;
    }
  });
}

async function readCurrentCostumeVectorObjectTypes(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const scene = project?.scenes?.[0];
    const object = scene?.objects?.[0];
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
    if (!vectorLayer?.vector?.fabricJson) {
      return [];
    }

    try {
      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as {
        objects?: Array<{ type?: unknown }>;
      };
      return Array.isArray(parsed.objects)
        ? parsed.objects.map((entry) => typeof entry.type === 'string' ? entry.type.toLowerCase() : '')
        : [];
    } catch {
      return [];
    }
  });
}

test.describe('Costume editor tools', () => {
  test('vector layers render shapes and reload cleanly after a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await expect(page.getByRole('button', { name: /^layer 2/i })).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.42, 0.38);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);

    await roundTripThroughCodeTab(page);

    await expect(page.getByRole('button', { name: /^layer 2/i })).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
  });

  test('costume text-size slider only commits on release', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await page.getByRole('button', { name: /^text$/i }).click();
    await clickCostumeCanvas(page, 0.58, 0.44);
    await page.keyboard.type('Hi');
    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.58, 0.44);

    await expect.poll(async () => readCurrentCostumeTextFontSize(page), { timeout: 10000 }).not.toBeNull();
    const initialFontSize = await readCurrentCostumeTextFontSize(page);
    expect(initialFontSize).not.toBeNull();

    const fontSizeSlider = page.getByTestId('costume-toolbar-properties').getByRole('slider').first();
    await expect(fontSizeSlider).toBeVisible();

    await previewRangeSliderValueWithoutCommit(page, fontSizeSlider, 72);

    await expect.poll(async () => readCurrentCostumeTextFontSize(page), { timeout: 10000 }).toBe(initialFontSize ?? null);

    await commitRangeSliderValue(page);

    await expect.poll(async () => readCurrentCostumeTextFontSize(page), { timeout: 10000 }).toBe(72);
  });

  test('costume text-size slider commits a clamped max release beyond the track edge', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await page.getByRole('button', { name: /^text$/i }).click();
    await clickCostumeCanvas(page, 0.58, 0.44);
    await page.keyboard.type('Hi');
    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.58, 0.44);

    await expect.poll(async () => readCurrentCostumeTextFontSize(page), { timeout: 10000 }).not.toBeNull();
    const initialFontSize = await readCurrentCostumeTextFontSize(page);
    expect(initialFontSize).not.toBeNull();

    const fontSizeSlider = page.getByTestId('costume-toolbar-properties').getByRole('slider').first();
    await expect(fontSizeSlider).toBeVisible();

    await previewRangeSliderValueWithoutCommit(page, fontSizeSlider, 120, { overshootPx: 32 });

    await expect.poll(async () => readCurrentCostumeTextFontSize(page), { timeout: 10000 }).toBe(initialFontSize ?? null);

    await commitRangeSliderValue(page);

    await expect.poll(async () => readCurrentCostumeTextFontSize(page), { timeout: 10000 }).toBe(120);
  });

  test('costume rectangle tool commits plain path objects', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.26, 0.24, 0.52, 0.46);

    await expect.poll(async () => readCurrentCostumeVectorObjectTypes(page), { timeout: 10000 }).toEqual(['path']);
  });

  test('vector copy and paste works across different objects and costumes', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.4, 0.38);

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.31, 0.3);
    await page.keyboard.press('ControlOrMeta+C');

    await page.getByRole('button', { name: /add object/i }).click();
    await page.getByText(/^Object 2$/).first().click();
    await page.getByRole('radio', { name: /^costumes?$/i }).click();
    await addVectorLayer(page);

    await page.keyboard.press('ControlOrMeta+V');

    await expect.poll(async () => readObjectCurrentCostumeVectorObjectCount(page, 'Object 2'), { timeout: 10000 }).toBe(1);
    await expect.poll(async () => readObjectCurrentCostumeVectorObjectCount(page, 'Object 1'), { timeout: 10000 }).toBe(1);
  });

  test('vector context menu shows Copy, Cut, Paste, Duplicate and pastes in order', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.4, 0.38);

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.31, 0.3);

    await openCostumeVectorContextMenu(page, 0.31, 0.3);
    await expectVectorContextMenuOrder(page);
    await page.getByTestId('vector-selection-context-menu').getByRole('button', { name: /^copy$/i }).click();

    await openCostumeVectorContextMenu(page, 0.5, 0.5);
    await expectVectorContextMenuOrder(page);
    await page.getByTestId('vector-selection-context-menu').getByRole('button', { name: /^paste$/i }).click();

    await expect.poll(async () => readObjectCurrentCostumeVectorObjectCount(page, 'Object 1'), { timeout: 10000 }).toBe(2);
  });

  test('vector selections move with arrow keys in the costume editor', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.4, 0.38);

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.31, 0.3);
    const beforePosition = await readObjectCurrentCostumeVectorObjectPosition(page, 'Object 1');
    expect(beforePosition).not.toBeNull();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');

    await expect.poll(async () => {
      const afterPosition = await readObjectCurrentCostumeVectorObjectPosition(page, 'Object 1');
      if (!beforePosition || !afterPosition) {
        return null;
      }
      return {
        dx: (afterPosition.left ?? 0) - (beforePosition.left ?? 0),
        dy: (afterPosition.top ?? 0) - (beforePosition.top ?? 0),
      };
    }, { timeout: 10000 }).toEqual({ dx: 10, dy: 1 });
  });

  test('bitmap tools paint on the active layer and survive a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^brush$/i }).click();

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.40, 0.40);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('hard bitmap brush preview honors stroke opacity before commit', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await page.getByRole('button', { name: /new blank costume/i }).click();
    await addBitmapLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Hard');
    await setBrushColorOpacity(page, 35);

    const box = await getCostumeCanvasBox(page);
    const startX = box.x + box.width * 0.24;
    const startY = box.y + box.height * 0.28;
    const endX = box.x + box.width * 0.56;
    const endY = box.y + box.height * 0.28;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });

    await expect.poll(async () => readPreviewLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const previewAlpha = await readPreviewLayerMaxAlpha(page);
    expect(previewAlpha).toBeLessThan(110);

    await page.mouse.up();
  });

  test('bitmap textured brush commits on mouse-up and survives a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Crayon');

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.40, 0.40);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('vector textured pencil preview renders live before mouse-up in the costume editor', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.getByRole('button', { name: /^pencil$/i }).click();
    await setVectorStrokeBrush(page, 'Crayon');

    const box = await getCostumeCanvasBox(page);
    const startX = box.x + box.width * 0.26;
    const startY = box.y + box.height * 0.28;
    const endX = box.x + box.width * 0.58;
    const endY = box.y + box.height * 0.42;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });

    await expect.poll(
      async () => readOverlayOpaqueSampleCount(page, '[data-testid="costume-vector-texture-overlay"]'),
      { timeout: 10000 },
    ).toBeGreaterThan(10);

    await page.mouse.up();
  });

  test('vector textured pen preview renders live before the path is committed in the costume editor', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.getByRole('button', { name: /^pen$/i }).click();
    await setVectorStrokeBrush(page, 'Crayon');

    const box = await getCostumeCanvasBox(page);
    const anchorX = box.x + box.width * 0.34;
    const anchorY = box.y + box.height * 0.3;
    const hoverX = box.x + box.width * 0.62;
    const hoverY = box.y + box.height * 0.52;

    await page.mouse.click(anchorX, anchorY);
    await page.mouse.move(hoverX, hoverY);

    await expect.poll(
      async () => readOverlayOpaqueSampleCount(page, '[data-testid="costume-vector-texture-overlay"]'),
      { timeout: 10000 },
    ).toBeGreaterThan(10);
  });

  test('vector mode keeps the composed overlay authoritative over the Fabric artwork canvases', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await expect.poll(async () => {
      return await page.evaluate(() => {
        const overlay = document.querySelector('[data-testid="costume-vector-texture-overlay"]');
        const lower = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
        const upper = document.querySelector('[data-testid="costume-active-layer-host"] .upper-canvas');
        if (
          !(overlay instanceof HTMLCanvasElement)
          || !(lower instanceof HTMLCanvasElement)
          || !(upper instanceof HTMLCanvasElement)
        ) {
          return null;
        }

        const overlayStyle = getComputedStyle(overlay);
        const lowerStyle = getComputedStyle(lower);
        const upperStyle = getComputedStyle(upper);
        return {
          overlayOpacity: overlayStyle.opacity,
          lowerOpacity: lowerStyle.opacity,
          lowerVisibility: lowerStyle.visibility,
          upperOpacity: upperStyle.opacity,
        };
      });
    }, { timeout: 10000 }).toEqual({
      overlayOpacity: '1',
      lowerOpacity: '0',
      lowerVisibility: 'hidden',
      upperOpacity: '0',
    });
  });

  test('costume editor preserves object stacking when a textured fill sits behind a later solid shape', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
      if (!scene || !object || !costume?.id || !costume.assetId) {
        throw new Error('Missing scene object costume for vector stacking test.');
      }

      const fabricJson = JSON.stringify({
        version: '7.0.0',
        objects: [
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 180,
            top: 180,
            width: 420,
            height: 420,
            fill: 'rgba(34, 197, 94, 0)',
            stroke: 'rgba(34, 197, 94, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#22C55E',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#22C55E',
            vectorStrokeOpacity: 1,
          },
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 360,
            top: 360,
            width: 280,
            height: 280,
            fill: '#EF4444',
            stroke: 'rgba(239, 68, 68, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'solid',
            vectorFillColor: '#EF4444',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#EF4444',
            vectorStrokeOpacity: 1,
          },
        ],
      });

      useProjectStore.getState().updateCostumeFromEditor(
        {
          sceneId: scene.id,
          objectId: object.id,
          costumeId: costume.id,
        },
        {
          assetId: costume.assetId,
          bounds: costume.bounds,
          assetFrame: costume.assetFrame,
          document: {
            version: 1,
            activeLayerId: 'stacking-vector-layer',
            layers: [
              {
                id: 'stacking-vector-layer',
                name: 'Vector Layer',
                kind: 'vector',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                mask: null,
                effects: [],
                vector: {
                  engine: 'fabric',
                  version: 1,
                  fabricJson,
                },
              },
            ],
          },
        },
      );
    });

    await roundTripThroughCodeTab(page);

    const overlap = await page.evaluate(async () => {
      const [{ useProjectStore }, { renderCostumeLayerToCanvas }] = await Promise.all([
        import('/src/store/projectStore.ts'),
        import('/src/lib/costume/costumeDocumentRender.ts'),
      ]);
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
      const layer = costume?.document?.layers?.find((candidate) => candidate.id === costume.document?.activeLayerId);
      if (!layer) {
        return null;
      }

      const canvas = await renderCostumeLayerToCanvas(layer);
      if (!canvas) {
        return null;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return null;
      }

      const data = ctx.getImageData(500, 500, 1, 1).data;
      return {
        r: data[0] ?? 0,
        g: data[1] ?? 0,
        b: data[2] ?? 0,
        a: data[3] ?? 0,
      };
    });

    expect(overlap).not.toBeNull();
    expect(overlap?.a ?? 0).toBeGreaterThan(0);
    expect((overlap?.r ?? 0)).toBeGreaterThan((overlap?.g ?? 0) * 1.4);
  });

  test('grouped costume vector selections stay visible after Cmd/Ctrl+G', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
      if (!scene || !object || !costume?.id || !costume.assetId) {
        throw new Error('Missing scene object costume for grouped vector visibility test.');
      }

      const fabricJson = JSON.stringify({
        version: '7.0.0',
        objects: [
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 320,
            top: 340,
            width: 150,
            height: 160,
            fill: 'rgba(34, 197, 94, 0)',
            stroke: 'rgba(34, 197, 94, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#22C55E',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#22C55E',
            vectorStrokeOpacity: 1,
          },
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 540,
            top: 350,
            width: 170,
            height: 190,
            fill: 'rgba(37, 99, 235, 0)',
            stroke: 'rgba(37, 99, 235, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#2563EB',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#2563EB',
            vectorStrokeOpacity: 1,
          },
        ],
      });

      useProjectStore.getState().updateCostumeFromEditor(
        {
          sceneId: scene.id,
          objectId: object.id,
          costumeId: costume.id,
        },
        {
          assetId: costume.assetId,
          bounds: costume.bounds,
          assetFrame: costume.assetFrame,
          document: {
            version: 1,
            activeLayerId: 'group-visibility-vector-layer',
            layers: [
              {
                id: 'group-visibility-vector-layer',
                name: 'Vector Layer',
                kind: 'vector',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                mask: null,
                effects: [],
                vector: {
                  engine: 'fabric',
                  version: 1,
                  fabricJson,
                },
              },
            ],
          },
        },
      );
    });

    await roundTripThroughCodeTab(page);

    const firstCenter = { x: 395, y: 420 };
    const secondCenter = { x: 625, y: 445 };
    const outsideSample = { x: 120, y: 120 };

    await expect.poll(async () => {
      const firstPixel = await readCostumeEditorCompositePixel(page, firstCenter);
      const secondPixel = await readCostumeEditorCompositePixel(page, secondCenter);
      const outsidePixel = await readCostumeEditorCompositePixel(page, outsideSample);
      if (!firstPixel || !secondPixel || !outsidePixel) {
        return false;
      }
      const firstVisible = firstPixel.a > 0 && JSON.stringify(firstPixel) !== JSON.stringify(outsidePixel);
      const secondVisible = secondPixel.a > 0 && JSON.stringify(secondPixel) !== JSON.stringify(outsidePixel);
      return firstVisible && secondVisible;
    }, { timeout: 10000 }).toBe(true);

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await page.keyboard.down('Shift');
    await clickCostumeCanvas(page, secondCenter.x / 1000, secondCenter.y / 1000);
    await page.keyboard.up('Shift');

    await page.keyboard.press('ControlOrMeta+G');

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes?.[0]?.objects?.[0];
        const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
        const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
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
    }, { timeout: 10000 }).toBe(1);

    await expect.poll(async () => {
      const firstPixel = await readCostumeEditorCompositePixel(page, firstCenter);
      const secondPixel = await readCostumeEditorCompositePixel(page, secondCenter);
      const outsidePixel = await readCostumeEditorCompositePixel(page, outsideSample);
      if (!firstPixel || !secondPixel || !outsidePixel) {
        return false;
      }
      const firstVisible = firstPixel.a > 0 && JSON.stringify(firstPixel) !== JSON.stringify(outsidePixel);
      const secondVisible = secondPixel.a > 0 && JSON.stringify(secondPixel) !== JSON.stringify(outsidePixel);
      return firstVisible && secondVisible;
    }, { timeout: 10000 }).toBe(true);
  });

  test('double-clicking a grouped costume object enters the group and selects the clicked child', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
      if (!scene || !object || !costume?.id || !costume.assetId) {
        throw new Error('Missing scene object costume for grouped child selection test.');
      }

      const fabricJson = JSON.stringify({
        version: '7.0.0',
        objects: [
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 320,
            top: 340,
            width: 150,
            height: 160,
            fill: 'rgba(34, 197, 94, 0)',
            stroke: 'rgba(34, 197, 94, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#22C55E',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#22C55E',
            vectorStrokeOpacity: 1,
          },
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 540,
            top: 350,
            width: 170,
            height: 190,
            fill: 'rgba(37, 99, 235, 0)',
            stroke: 'rgba(37, 99, 235, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#2563EB',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#2563EB',
            vectorStrokeOpacity: 1,
          },
        ],
      });

      useProjectStore.getState().updateCostumeFromEditor(
        {
          sceneId: scene.id,
          objectId: object.id,
          costumeId: costume.id,
        },
        {
          assetId: costume.assetId,
          bounds: costume.bounds,
          assetFrame: costume.assetFrame,
          document: {
            version: 1,
            activeLayerId: 'group-child-selection-vector-layer',
            layers: [
              {
                id: 'group-child-selection-vector-layer',
                name: 'Vector Layer',
                kind: 'vector',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                mask: null,
                effects: [],
                vector: {
                  engine: 'fabric',
                  version: 1,
                  fabricJson,
                },
              },
            ],
          },
        },
      );
    });

    await roundTripThroughCodeTab(page);

    const firstCenter = { x: 395, y: 420 };
    const secondCenter = { x: 625, y: 445 };

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await page.keyboard.down('Shift');
    await clickCostumeCanvas(page, secondCenter.x / 1000, secondCenter.y / 1000);
    await page.keyboard.up('Shift');
    await page.keyboard.press('ControlOrMeta+G');

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes?.[0]?.objects?.[0];
        const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
        const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
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
    }, { timeout: 10000 }).toBe(1);

    await doubleClickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    const fillButton = page.getByRole('button', { name: /^(fill|fill \(mixed\))$/i }).first();
    await fillButton.click();
    const hexInput = page.getByTestId('compact-color-picker-hex-input');
    await expect(hexInput).toBeVisible();
    await hexInput.fill('#EF4444');
    await hexInput.press('Enter');
    await fillButton.click();

    await expect.poll(async () => {
      const childColors = await readSavedCostumeGroupedChildFillColors(page);
      return childColors.length === 2
        && childColors.includes('#EF4444')
        && childColors.includes('#2563EB');
    }, { timeout: 10000 }).toBe(true);
  });

  test('Escape exits costume group editing to the root group without breaking the group', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
      if (!scene || !object || !costume?.id || !costume.assetId) {
        throw new Error('Missing scene object costume for grouped Escape test.');
      }

      const fabricJson = JSON.stringify({
        version: '7.0.0',
        objects: [
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 320,
            top: 340,
            width: 150,
            height: 160,
            fill: 'rgba(34, 197, 94, 0)',
            stroke: 'rgba(34, 197, 94, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#22C55E',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#22C55E',
            vectorStrokeOpacity: 1,
          },
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 540,
            top: 350,
            width: 170,
            height: 190,
            fill: 'rgba(37, 99, 235, 0)',
            stroke: 'rgba(37, 99, 235, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#2563EB',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#2563EB',
            vectorStrokeOpacity: 1,
          },
        ],
      });

      useProjectStore.getState().updateCostumeFromEditor(
        {
          sceneId: scene.id,
          objectId: object.id,
          costumeId: costume.id,
        },
        {
          assetId: costume.assetId,
          bounds: costume.bounds,
          assetFrame: costume.assetFrame,
          document: {
            version: 1,
            activeLayerId: 'group-escape-vector-layer',
            layers: [
              {
                id: 'group-escape-vector-layer',
                name: 'Vector Layer',
                kind: 'vector',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                mask: null,
                effects: [],
                vector: {
                  engine: 'fabric',
                  version: 1,
                  fabricJson,
                },
              },
            ],
          },
        },
      );
    });

    await roundTripThroughCodeTab(page);

    const firstCenter = { x: 395, y: 420 };
    const secondCenter = { x: 625, y: 445 };

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await page.keyboard.down('Shift');
    await clickCostumeCanvas(page, secondCenter.x / 1000, secondCenter.y / 1000);
    await page.keyboard.up('Shift');
    await page.keyboard.press('ControlOrMeta+G');

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes?.[0]?.objects?.[0];
        const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
        const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
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
    }, { timeout: 10000 }).toBe(1);

    await doubleClickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await page.keyboard.press('Escape');
    await clickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    const fillButton = page.getByRole('button', { name: /^(fill|fill \(mixed\))$/i }).first();
    await fillButton.click();
    const hexInput = page.getByTestId('compact-color-picker-hex-input');
    await expect(hexInput).toBeVisible();
    await hexInput.fill('#EF4444');
    await hexInput.press('Enter');
    await fillButton.click();

    await expect.poll(async () => {
      const childColors = await readSavedCostumeGroupedChildFillColors(page);
      return childColors.length === 2 && childColors.every((color) => color === '#EF4444');
    }, { timeout: 10000 }).toBe(true);
    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes?.[0]?.objects?.[0];
        const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
        const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
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
    }, { timeout: 10000 }).toBe(1);
  });

  test('clicking empty costume canvas exits group editing to the root group without breaking the group', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
      if (!scene || !object || !costume?.id || !costume.assetId) {
        throw new Error('Missing scene object costume for grouped background-click test.');
      }

      const fabricJson = JSON.stringify({
        version: '7.0.0',
        objects: [
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 320,
            top: 340,
            width: 150,
            height: 160,
            fill: 'rgba(34, 197, 94, 0)',
            stroke: 'rgba(34, 197, 94, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#22C55E',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#22C55E',
            vectorStrokeOpacity: 1,
          },
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 540,
            top: 350,
            width: 170,
            height: 190,
            fill: 'rgba(37, 99, 235, 0)',
            stroke: 'rgba(37, 99, 235, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#2563EB',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#2563EB',
            vectorStrokeOpacity: 1,
          },
        ],
      });

      useProjectStore.getState().updateCostumeFromEditor(
        {
          sceneId: scene.id,
          objectId: object.id,
          costumeId: costume.id,
        },
        {
          assetId: costume.assetId,
          bounds: costume.bounds,
          assetFrame: costume.assetFrame,
          document: {
            version: 1,
            activeLayerId: 'group-background-click-vector-layer',
            layers: [
              {
                id: 'group-background-click-vector-layer',
                name: 'Vector Layer',
                kind: 'vector',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                mask: null,
                effects: [],
                vector: {
                  engine: 'fabric',
                  version: 1,
                  fabricJson,
                },
              },
            ],
          },
        },
      );
    });

    await roundTripThroughCodeTab(page);

    const firstCenter = { x: 395, y: 420 };
    const secondCenter = { x: 625, y: 445 };

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await page.keyboard.down('Shift');
    await clickCostumeCanvas(page, secondCenter.x / 1000, secondCenter.y / 1000);
    await page.keyboard.up('Shift');
    await page.keyboard.press('ControlOrMeta+G');

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes?.[0]?.objects?.[0];
        const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
        const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
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
    }, { timeout: 10000 }).toBe(1);

    await doubleClickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await clickCostumeCanvas(page, 0.14, 0.14);
    await clickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    const fillButton = page.getByRole('button', { name: /^(fill|fill \(mixed\))$/i }).first();
    await fillButton.click();
    const hexInput = page.getByTestId('compact-color-picker-hex-input');
    await expect(hexInput).toBeVisible();
    await hexInput.fill('#EF4444');
    await hexInput.press('Enter');
    await fillButton.click();

    await expect.poll(async () => {
      const childColors = await readSavedCostumeGroupedChildFillColors(page);
      return childColors.length === 2 && childColors.every((color) => color === '#EF4444');
    }, { timeout: 10000 }).toBe(true);
    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes?.[0]?.objects?.[0];
        const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
        const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
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
    }, { timeout: 10000 }).toBe(1);
  });

  test('editing a grouped costume shape path converts it in place instead of duplicating it', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
      if (!scene || !object || !costume?.id || !costume.assetId) {
        throw new Error('Missing scene object costume for grouped path edit test.');
      }

      const fabricJson = JSON.stringify({
        version: '7.0.0',
        objects: [
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 320,
            top: 340,
            width: 150,
            height: 160,
            fill: 'rgba(34, 197, 94, 0)',
            stroke: 'rgba(34, 197, 94, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#22C55E',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#22C55E',
            vectorStrokeOpacity: 1,
          },
          {
            type: 'rect',
            version: '7.0.0',
            originX: 'left',
            originY: 'top',
            left: 540,
            top: 350,
            width: 170,
            height: 190,
            fill: 'rgba(37, 99, 235, 0)',
            stroke: 'rgba(37, 99, 235, 0)',
            strokeWidth: 0,
            vectorFillTextureId: 'crayon',
            vectorFillColor: '#2563EB',
            vectorFillOpacity: 1,
            vectorStrokeBrushId: 'solid',
            vectorStrokeColor: '#2563EB',
            vectorStrokeOpacity: 1,
          },
        ],
      });

      useProjectStore.getState().updateCostumeFromEditor(
        {
          sceneId: scene.id,
          objectId: object.id,
          costumeId: costume.id,
        },
        {
          assetId: costume.assetId,
          bounds: costume.bounds,
          assetFrame: costume.assetFrame,
          document: {
            version: 1,
            activeLayerId: 'group-path-edit-vector-layer',
            layers: [
              {
                id: 'group-path-edit-vector-layer',
                name: 'Vector Layer',
                kind: 'vector',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                mask: null,
                effects: [],
                vector: {
                  engine: 'fabric',
                  version: 1,
                  fabricJson,
                },
              },
            ],
          },
        },
      );
    });

    await roundTripThroughCodeTab(page);

    const firstCenter = { x: 395, y: 420 };
    const secondCenter = { x: 625, y: 445 };

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await page.keyboard.down('Shift');
    await clickCostumeCanvas(page, secondCenter.x / 1000, secondCenter.y / 1000);
    await page.keyboard.up('Shift');
    await page.keyboard.press('ControlOrMeta+G');

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes?.[0]?.objects?.[0];
        const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
        const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
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
    }, { timeout: 10000 }).toBe(1);

    await doubleClickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);
    await doubleClickCostumeCanvas(page, firstCenter.x / 1000, firstCenter.y / 1000);

    await expect.poll(async () => {
      const structure = await readSavedCostumeGroupedChildTypes(page);
      return structure.topLevelCount === 1
        && structure.childTypes.length === 2
        && structure.childTypes.filter((type) => type === 'path').length === 1
        && structure.childTypes.filter((type) => type === 'rect').length === 1;
    }, { timeout: 10000 }).toBe(true);
  });

  test('triangle shapes draw where the gesture starts in the costume editor', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.getByLabel('Open shape tools').click();
    await page.getByRole('menuitem', { name: /^triangle$/i }).click();

    await drawAcrossCostumeCanvas(page, 0.36, 0.24, 0.66, 0.6);
    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.51, 0.42);
    await expect.poll(async () => readCostumeSelectionGizmoBluePixelCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('star shapes draw where the gesture starts in the costume editor', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await addVectorLayer(page);

    await page.getByLabel('Open shape tools').click();
    await page.getByRole('menuitem', { name: /^star$/i }).click();

    await drawAcrossCostumeCanvas(page, 0.18, 0.48, 0.42, 0.8);
    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.3, 0.64);
    await expect.poll(async () => readCostumeSelectionGizmoBluePixelCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('fill and shape tools do not force a crosshair cursor in the costume editor', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^fill$/i }).click();
    await expect.poll(async () => readCostumeActiveLayerCursor(page)).toBe('default');

    await addVectorLayer(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await expect.poll(async () => readCostumeActiveLayerCursor(page)).toBe('default');
  });

  test('hard bitmap brush commit preserves stroke opacity', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await page.getByRole('button', { name: /new blank costume/i }).click();
    await addBitmapLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Hard');
    await setBrushColorOpacity(page, 35);

    await drawAcrossCostumeCanvas(page, 0.24, 0.3, 0.54, 0.3);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const alphaAfterCommit = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterCommit).toBeGreaterThan(70);
    expect(alphaAfterCommit).toBeLessThan(110);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const alphaAfterRoundTrip = await readHostedLayerMaxAlpha(page);
    expect(Math.abs(alphaAfterRoundTrip - alphaAfterCommit)).toBeLessThanOrEqual(6);

    await drawAcrossCostumeCanvas(page, 0.24, 0.3, 0.54, 0.3);
    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(alphaAfterCommit + 30);
    const alphaAfterSecondStroke = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterSecondStroke).toBeGreaterThan(alphaAfterCommit + 30);
  });

  test('soft bitmap brush uses opacity per stroke instead of flow accumulation', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await page.getByRole('button', { name: /new blank costume/i }).click();
    await addBitmapLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Soft');
    await setBrushColorOpacity(page, 35);

    await drawAcrossCostumeCanvas(page, 0.24, 0.36, 0.54, 0.36);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const alphaAfterFirstStroke = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterFirstStroke).toBeGreaterThan(70);
    expect(alphaAfterFirstStroke).toBeLessThan(110);

    await drawAcrossCostumeCanvas(page, 0.24, 0.36, 0.54, 0.36);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(alphaAfterFirstStroke + 30);
    const alphaAfterSecondStroke = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterSecondStroke).toBeGreaterThan(alphaAfterFirstStroke + 30);
  });

  test('bitmap shapes commit on the active layer and survive a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.44, 0.42);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('rapid bitmap eraser strokes preserve committed layer state across a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.60, 0.60);
    const beforeEraseSamples = await readCheckerboardInkSamples(page);
    expect(beforeEraseSamples).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^eraser$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.20, 0.20, 0.56, 0.20);
    await drawAcrossCostumeCanvas(page, 0.20, 0.30, 0.56, 0.30);
    await drawAcrossCostumeCanvas(page, 0.20, 0.40, 0.56, 0.40);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(beforeEraseSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(beforeEraseSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('eraser commit does not flash back to the stale hosted layer image', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.60, 0.60);
    const beforeEraseSamples = await readHostedLayerInkSamples(page);
    expect(beforeEraseSamples).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^eraser$/i }).click();
    const timelinePromise = observeVisibleHostedLayerInkTimeline(page);
    await drawAcrossCostumeCanvas(page, 0.20, 0.30, 0.56, 0.30);
    const timeline = await timelinePromise;

    const finalHostedSamples = await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeLessThan(beforeEraseSamples).then(async () => {
      return await readHostedLayerInkSamples(page);
    });

    expect(timeline.length).toBeGreaterThan(0);
    const settleThreshold = finalHostedSamples + 2;
    const reboundThreshold = finalHostedSamples + Math.max(6, Math.floor((beforeEraseSamples - finalHostedSamples) * 0.45));
    const firstSettledIndex = timeline.findIndex((value) => value <= settleThreshold);
    const reboundDetected = firstSettledIndex >= 0
      && timeline.slice(firstSettledIndex + 1).some((value) => value >= reboundThreshold);

    expect(reboundDetected).toBe(false);
  });

  test('rapid bitmap stroke undo and redo keep editor and persisted costume state aligned', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const undoButton = page.getByRole('button', { name: /^undo$/i }).first();
    const redoButton = page.getByRole('button', { name: /^redo$/i }).first();

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.64, 0.64);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
    await expect(undoButton).toBeEnabled({ timeout: 10000 });
    const baseSamples = await readCheckerboardInkSamples(page);
    await expect.poll(async () => !!(await readCurrentCostumeDocumentSignature(page)), { timeout: 10000 }).toBe(true);
    const baseDocumentSignature = await readCurrentCostumeDocumentSignature(page);
    expect(baseDocumentSignature).toBeTruthy();

    await page.getByRole('button', { name: /^eraser$/i }).click();
    for (const yFactor of [0.24, 0.34, 0.44, 0.54]) {
      await drawAcrossCostumeCanvas(page, 0.20, yFactor, 0.60, yFactor);
    }

    let undoCount = 0;
    for (let index = 0; index < 10; index += 1) {
      const currentSignature = await readCurrentCostumeDocumentSignature(page);
      const currentSamples = await readCheckerboardInkSamples(page);
      if (currentSignature === baseDocumentSignature) {
        break;
      }
      if (!await undoButton.isEnabled()) {
        break;
      }
      await undoButton.click();
      undoCount += 1;
      await expect.poll(async () => {
        const nextSignature = await readCurrentCostumeDocumentSignature(page);
        const nextSamples = await readCheckerboardInkSamples(page);
        return nextSignature !== currentSignature || nextSamples !== currentSamples;
      }, { timeout: 10000 }).toBe(true);
    }
    expect(undoCount).toBeGreaterThan(0);

    await expect.poll(async () => readCurrentCostumeDocumentSignature(page), { timeout: 10000 }).toBe(baseDocumentSignature);
    await expect.poll(async () => {
      const samples = await readCheckerboardInkSamples(page);
      return Math.abs(samples - baseSamples) <= Math.max(250, Math.ceil(baseSamples * 0.05));
    }, { timeout: 10000 }).toBe(true);

    let redoCount = 0;
    for (let index = 0; index < undoCount; index += 1) {
      await expect(redoButton).toBeEnabled({ timeout: 10000 });
      const currentSignature = await readCurrentCostumeDocumentSignature(page);
      const currentSamples = await readCheckerboardInkSamples(page);
      await redoButton.click();
      redoCount += 1;
      await expect.poll(async () => {
        const nextSignature = await readCurrentCostumeDocumentSignature(page);
        const nextSamples = await readCheckerboardInkSamples(page);
        return nextSignature !== currentSignature || nextSamples !== currentSamples;
      }, { timeout: 10000 }).toBe(true);
    }
    expect(redoCount).toBe(undoCount);

    await expect.poll(async () => (await readCurrentCostumeDocumentSignature(page)) !== baseDocumentSignature, { timeout: 10000 }).toBe(true);
    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(baseSamples);
    await expect(redoButton).toBeDisabled({ timeout: 10000 });
  });

  test('undo reloads the costume canvas and layer thumbnail before the next edit branches history', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const layerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    const undoButton = page.getByRole('button', { name: /^undo$/i }).first();
    const redoButton = page.getByRole('button', { name: /^redo$/i }).first();

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.14, 0.14, 0.54, 0.54);

    await expectLayerThumbnail(layerButton);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(async () => !!(await readCurrentCostumeDocumentSignature(page)), { timeout: 10000 }).toBe(true);

    const baseHostedSamples = await readHostedLayerInkSamples(page);
    const baseThumbnailSrc = await readLayerThumbnailSrc(layerButton);
    const baseDocumentSignature = await readCurrentCostumeDocumentSignature(page);
    expect(baseThumbnailSrc).toMatch(/^data:image\/png;base64,/);
    expect(baseDocumentSignature).toBeTruthy();

    await page.getByRole('button', { name: /^eraser$/i }).click();
    for (const yFactor of [0.22, 0.32, 0.42, 0.52]) {
      await drawAcrossCostumeCanvas(page, 0.18, yFactor, 0.50, yFactor);
    }

    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeLessThan(baseHostedSamples);
    await expect.poll(async () => readLayerThumbnailSrc(layerButton), { timeout: 10000 }).not.toBe(baseThumbnailSrc);

    for (let index = 0; index < 10; index += 1) {
      const currentSignature = await readCurrentCostumeDocumentSignature(page);
      if (currentSignature === baseDocumentSignature) {
        break;
      }
      await expect(undoButton).toBeEnabled({ timeout: 10000 });
      await undoButton.click();
    }

    await expect.poll(async () => readCurrentCostumeDocumentSignature(page), { timeout: 10000 }).toBe(baseDocumentSignature);
    await expect.poll(async () => {
      const samples = await readHostedLayerInkSamples(page);
      return Math.abs(samples - baseHostedSamples) <= Math.max(150, Math.ceil(baseHostedSamples * 0.05));
    }, { timeout: 10000 }).toBe(true);
    await expect.poll(async () => readLayerThumbnailSrc(layerButton), { timeout: 10000 }).toBe(baseThumbnailSrc);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.66, 0.14, 0.86, 0.34);

    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(baseHostedSamples);
    await expect.poll(async () => readLayerThumbnailSrc(layerButton), { timeout: 10000 }).not.toBe(baseThumbnailSrc);
    await expect(redoButton).toBeDisabled({ timeout: 10000 });
  });

  test('active hosted layer stays visible after switching away from and back to the costume tab', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.36, 0.34);

    await addVectorLayer(page);
    const vectorLayerButton = page.getByRole('button', { name: /^layer 2 vector$/i });
    const bitmapLayerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await expect(vectorLayerButton).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.54, 0.28, 0.80, 0.54);

    await bitmapLayerButton.click();
    await waitForCostumeCanvasReady(page);
    await vectorLayerButton.click();
    await waitForCostumeCanvasReady(page);

    const hostedSamplesBefore = await readHostedLayerInkSamples(page);
    expect(hostedSamplesBefore).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect(vectorLayerButton).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('bitmap select stays on the explicit layer and does not auto-switch from canvas clicks', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await expect(page.getByRole('button', { name: /box select/i })).toHaveCount(0);

    await addVectorLayer(page);
    await expect(page.getByRole('button', { name: /^layer 2/i })).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.56, 0.30, 0.80, 0.58);

    const layer2Button = page.getByRole('button', { name: /^layer 2 vector$/i });
    const layer1Button = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'true');

    await layer1Button.click();
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^select$/i }).click();
    await expect(layer1Button).toHaveAttribute('aria-pressed', 'true');
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'false');

    await clickCostumeCanvas(page, 0.68, 0.44);

    await expect(layer1Button).toHaveAttribute('aria-pressed', 'true');
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'false');
  });

  test('pixel marquee selection shows its gizmo immediately after mouse-up', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.24, 0.24, 0.46, 0.46);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^select$/i }).click();
    expect(await readCostumeSelectionGizmoBluePixelCount(page)).toBeLessThan(40);

    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.52, 0.52);

    await expect.poll(async () => readCostumeSelectionGizmoBluePixelCount(page), { timeout: 10000 }).toBeGreaterThan(120);
  });

  test('pixel marquee selection stays visible while dragging in the costume editor', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^select$/i }).click();

    const box = await getCostumeCanvasBox(page);
    const startX = box.x + box.width * 0.18;
    const startY = box.y + box.height * 0.18;
    const endX = box.x + box.width * 0.52;
    const endY = box.y + box.height * 0.52;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });

    await expect.poll(
      async () => readOverlayOpaqueSampleCount(page, '[data-testid="costume-bitmap-selection-overlay"]'),
      { timeout: 10000 },
    ).toBeGreaterThan(10);

    await page.mouse.up();
  });

  test('costume vector marquee selection box stays visible while dragging', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^select$/i }).click();
    expect(await readCostumeSelectionGizmoBluePixelCount(page)).toBeLessThan(40);

    const box = await getCostumeCanvasBox(page);
    const startX = box.x + box.width * 0.18;
    const startY = box.y + box.height * 0.18;
    const endX = box.x + box.width * 0.52;
    const endY = box.y + box.height * 0.52;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });

    await expect.poll(async () => {
      return await readCostumeOverlayBluePixelCountInCanvasRegion(page, {
        xFactor: 0.16,
        yFactor: 0.16,
        widthFactor: 0.38,
        heightFactor: 0.38,
      });
    }, { timeout: 10000 }).toBeGreaterThan(120);
    await expect.poll(async () => {
      return await readCostumeOverlayBluePixelCountInCanvasRegion(page, {
        xFactor: 0.68,
        yFactor: 0.16,
        widthFactor: 0.16,
        heightFactor: 0.28,
      });
    }, { timeout: 10000 }).toBeLessThan(20);

    await page.mouse.up();
  });

  test('costume vector marquee highlights included objects instead of relying on hover', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.28, 0.28, 0.44, 0.44);

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.1, 0.1);

    await expect.poll(async () => {
      return await readCostumeOverlayBluePixelCountInCanvasRegion(page, {
        xFactor: 0.26,
        yFactor: 0.26,
        widthFactor: 0.20,
        heightFactor: 0.20,
      });
    }, { timeout: 10000 }).toBeLessThan(10);

    const box = await getCostumeCanvasBox(page);
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.72, { steps: 12 });

    await expect.poll(async () => {
      return await readCostumeOverlayBluePixelCountInCanvasRegion(page, {
        xFactor: 0.26,
        yFactor: 0.26,
        widthFactor: 0.20,
        heightFactor: 0.20,
      });
    }, { timeout: 10000 }).toBeGreaterThan(20);

    await page.mouse.up();
  });

  test('costume vector hover outline keeps a constant screen width across zoom levels', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.4, 0.4, 0.6, 0.6);

    await page.getByRole('button', { name: /^select$/i }).click();
    await clickCostumeCanvas(page, 0.5, 0.5);

    const zoomButton = page.getByRole('button', { name: 'Zoom options' }).last();
    const zoomToSelectionLabel = /zoom to selection/i;
    await zoomButton.click();
    await page.getByRole('menuitem', { name: zoomToSelectionLabel }).click();

    await clickCostumeCanvas(page, 0.1, 0.1);

    const box = await getCostumeCanvasBox(page);
    const centerX = box.x + box.width * 0.5;
    const centerY = box.y + box.height * 0.5;
    await page.mouse.move(centerX, centerY);

    await expect.poll(
      async () => readCostumeOverlayTopEdgeThickness(page),
      { timeout: 10000 },
    ).toBeGreaterThan(0);
    const initialThickness = await readCostumeOverlayTopEdgeThickness(page);

    const initialZoomText = (await zoomButton.textContent())?.trim() ?? '';
    await zoomButton.click();
    await page.getByRole('menuitem', { name: /zoom in/i }).click();
    await expect(zoomButton).not.toContainText(initialZoomText);

    await page.mouse.move(centerX, centerY);
    await expect.poll(
      async () => readCostumeOverlayTopEdgeThickness(page),
      { timeout: 10000 },
    ).toBeGreaterThan(0);
    const zoomedThickness = await readCostumeOverlayTopEdgeThickness(page);

    expect(Math.abs(zoomedThickness - initialThickness)).toBeLessThanOrEqual(1);
  });

  test('costume editor chrome stays above the canvas stack on deeper layer stacks', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    for (let index = 0; index < 5; index += 1) {
      await addVectorLayer(page);
      await waitForCostumeCanvasReady(page);
    }

    await page.getByRole('button', { name: /^pencil$/i }).click();

    const propertyBar = page.getByTestId('costume-toolbar-properties');
    const toolBar = page.getByTestId('costume-toolbar-tools');
    const layerPanel = page.getByTestId('layer-panel');

    await expect(propertyBar).toBeVisible();
    await expect(toolBar).toBeVisible();
    await expect(layerPanel).toBeVisible();

    const chromeLayers = {
      propertyBar: await readNearestStackingZIndex(propertyBar),
      toolBar: await readNearestStackingZIndex(toolBar),
      layerPanel: await readNearestStackingZIndex(layerPanel),
    };
    const canvasLayers = await page.evaluate(() => {
      const readZIndex = (selector: string) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
          return 0;
        }
        return Number.parseInt(getComputedStyle(element).zIndex || '0', 10) || 0;
      };

      return {
        activeLayerVisual: readZIndex('[data-testid="costume-active-layer-visual"]'),
        vectorGuide: readZIndex('[data-testid="costume-vector-guide-overlay"]'),
        brushCursor: readZIndex('[data-testid="costume-brush-cursor-overlay"]'),
      };
    });

    expect(canvasLayers.activeLayerVisual).toBeGreaterThan(10);
    expect(chromeLayers.propertyBar).toBeGreaterThan(canvasLayers.activeLayerVisual);
    expect(chromeLayers.toolBar).toBeGreaterThan(canvasLayers.activeLayerVisual);
    expect(chromeLayers.layerPanel).toBeGreaterThan(canvasLayers.activeLayerVisual);
    expect(chromeLayers.propertyBar).toBeGreaterThan(canvasLayers.vectorGuide);
    expect(chromeLayers.toolBar).toBeGreaterThan(canvasLayers.brushCursor);

    await expectLocatorToBeTopmost(propertyBar);
    await expectLocatorToBeTopmost(toolBar);
    await expectLocatorToBeTopmost(layerPanel);
  });

  test('layer panel renders thumbnails for bitmap and vector layers', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const bitmapLayerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await page.getByRole('button', { name: /^brush$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.36, 0.34);
    await expectLayerThumbnail(bitmapLayerButton);

    await addVectorLayer(page);
    const vectorLayerButton = page.getByRole('button', { name: /^layer 2 vector$/i });
    await expect(vectorLayerButton).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.54, 0.28, 0.80, 0.54);
    await expectLayerThumbnail(vectorLayerButton);
  });

  test('layer thumbnail stays visible while a bitmap layer thumbnail refreshes', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const bitmapLayerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await page.getByRole('button', { name: /^brush$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.36, 0.34);
    await expectLayerThumbnail(bitmapLayerButton);

    const observerKey = `bitmap-layer-thumbnail-${Date.now()}`;
    await startLayerThumbnailVisibilityObserver(bitmapLayerButton, observerKey);
    await drawAcrossCostumeCanvas(page, 0.38, 0.22, 0.60, 0.40);
    await expectLayerThumbnail(bitmapLayerButton);

    expect(await stopLayerThumbnailVisibilityObserver(bitmapLayerButton, observerKey)).toBe(false);
  });

  test('newly created layer becomes active without an intermediate old-selection frame', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await startLayerSelectionObserver(page);
    await addVectorLayer(page);

    const layer2Button = page.getByRole('button', { name: /^layer 2 vector$/i });
    const layer1Button = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'true');
    await expect(layer1Button).toHaveAttribute('aria-pressed', 'false');

    const timeline = await stopLayerSelectionObserver(page);
    const invalidSnapshot = timeline.find((snapshot) => {
      const layer1 = snapshot.find((entry) => /^layer 1 bitmap$/i.test(entry.label));
      const layer2 = snapshot.find((entry) => /^layer 2 vector$/i.test(entry.label));
      return !!layer2 && (layer2.pressed !== true || layer1?.pressed === true);
    });

    expect(invalidSnapshot).toBeUndefined();
  });

  test('animated track selection switches the toolbar and properties to the active track kind', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const { convertStaticCostumeToAnimated, createAnimatedCostumeTrack } = await import('/src/lib/costume/costumeDocument.ts');

      const store = useProjectStore.getState();
      const project = store.project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object.currentCostumeIndex ?? 0];
      if (!scene?.id || !object?.id || !costume || costume.kind !== 'static') {
        throw new Error('Expected a selected object with a static costume.');
      }

      const animatedCostume = convertStaticCostumeToAnimated(costume, { totalFrames: 4 });
      const vectorTrack = createAnimatedCostumeTrack('vector', {
        name: 'Layer 2',
        totalFrames: 4,
      });
      vectorTrack.cels[0].startFrame = 2;
      vectorTrack.cels[0].durationFrames = 2;
      animatedCostume.clip.tracks.push(vectorTrack);

      store.updateObject(scene.id, object.id, {
        costumes: [animatedCostume],
        currentCostumeIndex: 0,
      });
    });

    const brushButton = page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^brush$/i });
    const penButton = page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^pen$/i });
    const eraserButton = page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^eraser$/i });
    const propertiesBar = page.getByTestId('costume-toolbar-properties');
    const bitmapBrushKindButton = propertiesBar.getByRole('button', { name: /^hard$/i });
    const vectorTrackButton = page.getByRole('button', { name: /^layer 2 vector$/i });

    await expect(vectorTrackButton).toBeVisible({ timeout: 10000 });
    await brushButton.click();
    await expect(eraserButton).toBeVisible();
    await expect(penButton).toHaveCount(0);
    await expect(bitmapBrushKindButton).toBeVisible();

    await vectorTrackButton.click();

    await expect(penButton).toBeVisible();
    await expect(eraserButton).toHaveCount(0);
    await expect(bitmapBrushKindButton).toHaveCount(0);
  });

  test('adding bitmap and vector layers each undo and redo in a single history step', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const undoButton = page.getByRole('button', { name: /^undo$/i }).first();
    const redoButton = page.getByRole('button', { name: /^redo$/i }).first();
    const baseLayerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });

    const assertSingleStepLayerAddUndoRedo = async (
      addLayer: () => Promise<void>,
      addedLayerName: RegExp,
    ) => {
      const addedLayerButton = page.getByRole('button', { name: addedLayerName });

      await addLayer();
      await waitForCostumeCanvasReady(page);
      await expect(addedLayerButton).toBeVisible({ timeout: 10000 });
      await expect(addedLayerButton).toHaveAttribute('aria-pressed', 'true');

      await expect(undoButton).toBeEnabled({ timeout: 10000 });
      await undoButton.click();
      await waitForCostumeCanvasReady(page);
      await expect(addedLayerButton).toHaveCount(0);
      await expect(baseLayerButton).toHaveAttribute('aria-pressed', 'true');

      await expect(redoButton).toBeEnabled({ timeout: 10000 });
      await redoButton.click();
      await waitForCostumeCanvasReady(page);
      await expect(addedLayerButton).toBeVisible({ timeout: 10000 });
      await expect(addedLayerButton).toHaveAttribute('aria-pressed', 'true');

      await expect(undoButton).toBeEnabled({ timeout: 10000 });
      await undoButton.click();
      await waitForCostumeCanvasReady(page);
      await expect(addedLayerButton).toHaveCount(0);
      await expect(baseLayerButton).toHaveAttribute('aria-pressed', 'true');
    };

    await assertSingleStepLayerAddUndoRedo(
      async () => addBitmapLayer(page),
      /^layer 2 bitmap$/i,
    );
    await assertSingleStepLayerAddUndoRedo(
      async () => addVectorLayer(page),
      /^layer 2 vector$/i,
    );
  });

  test('shared layer hover keeps visibility toggle and inline rename interactive', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const layerRow = page.locator('[data-testid="layer-row"]').first();
    await page.getByTestId('layer-add-button').hover();
    await expect(layerRow.getByTestId('costume-layer-thumbnail-hidden-indicator')).toHaveCount(0);

    const visibilityButton = layerRow.getByRole('button', { name: /^hide layer$/i });
    await expect(visibilityButton).toBeVisible();
    await visibilityButton.click();
    await expect(layerRow.getByRole('button', { name: /^show layer$/i })).toBeVisible();
    await expect(layerRow.getByTestId('costume-layer-thumbnail-hidden-indicator')).toBeVisible();

    await layerRow.getByText(/^Layer 1$/i).dblclick();
    const renameInput = layerRow.locator('input');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Sketch Layer');
    await renameInput.press('Enter');

    await expect(layerRow).toHaveAttribute('data-layer-name', 'Sketch Layer');
    await expect(page.getByRole('button', { name: /^sketch layer bitmap$/i })).toBeVisible();
  });

  test('leaving the layer rail dismisses hover unless the context menu is open', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const layerRow = page.locator('[data-testid="layer-row"]').first();
    const canvasSurface = page.getByTestId('costume-canvas-surface');

    await page.getByTestId('layer-add-button').hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeGreaterThan(200);

    await canvasSurface.hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeLessThan(120);

    await page.getByTestId('layer-add-button').hover();
    await layerRow.click({ button: 'right' });
    const opacitySlider = page.getByLabel('Layer opacity');
    await expect(opacitySlider).toBeVisible();
    await opacitySlider.hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeGreaterThan(200);

    await page.keyboard.press('Escape');
    await canvasSurface.hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeLessThan(120);
  });

  test('layer opacity slider commits endpoint values on release', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await setActiveLayerOpacity(page, 60);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(0.6);

    await setActiveLayerOpacity(page, 100);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(1);

    await setActiveLayerOpacity(page, 35);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(0.35);

    await setActiveLayerOpacity(page, 0);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(0);
  });
});
