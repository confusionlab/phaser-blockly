import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

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

async function openCostumeEditor(page: Page): Promise<void> {
  await bootstrapEditorProject(page, {
    projectName: `Circle Anchor Drag ${Date.now()}`,
    addObject: true,
  });

  await page.getByRole('radio', { name: /^costumes?$/i }).click();
  await expect(page.getByTestId('layer-add-button')).toBeVisible({ timeout: 10000 });
  await waitForCostumeCanvasReady(page);
}

async function addVectorLayer(page: Page): Promise<void> {
  await page.getByTestId('layer-add-button').click();
  await page.getByRole('menuitem', { name: /^vector$/i }).click();
  await page.locator('[data-testid="layer-row"][data-layer-kind="vector"]').last().click();
}

test('dragging a circle anchor keeps the vector path closed', async ({ page }) => {
  await openCostumeEditor(page);
  await addVectorLayer(page);

  await page.getByLabel('Open shape tools').click();
  await page.getByRole('menuitem', { name: /^circle$/i }).click();

  const surface = page.getByTestId('costume-canvas-surface');
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error('Costume canvas surface is missing a bounding box.');
  }

  const startX = box.x + box.width * 0.28;
  const startY = box.y + box.height * 0.22;
  const endX = box.x + box.width * 0.62;
  const endY = box.y + box.height * 0.7;
  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  await page.getByRole('button', { name: /^select$/i }).click();
  await page.mouse.dblclick(centerX, centerY);
  await page.waitForTimeout(300);

  await page.mouse.move(endX, centerY);
  await page.mouse.down();
  await page.mouse.move(endX - 36, centerY + 18, { steps: 10 });
  await page.mouse.up();

  const readSavedPathState = async () => {
    return await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const scene = project?.scenes?.[0];
      const object = scene?.objects?.[0];
      const costume = object?.costumes?.[object.currentCostumeIndex ?? 0];
      const vectorLayer = costume?.document?.layers?.find((layer) => layer.kind === 'vector');
      if (!vectorLayer?.vector?.fabricJson) {
        return null;
      }

      const parsed = JSON.parse(vectorLayer.vector.fabricJson) as {
        objects?: Array<{ path?: unknown[]; type?: string; vectorPathClosed?: unknown }>;
      };
      const firstObject = parsed.objects?.[0];
      const path = Array.isArray(firstObject?.path) ? firstObject.path : null;
      if (!path || path.length === 0) {
        return null;
      }

      const startCommand = Array.isArray(path[0]) ? path[0] : null;
      const lastDrawable = [...path].reverse().find((command) => Array.isArray(command) && String(command[0]).toUpperCase() !== 'Z') ?? null;
      if (!startCommand || !lastDrawable || startCommand.length < 3 || lastDrawable.length < 3) {
        return null;
      }

      const start = {
        x: Number(startCommand[startCommand.length - 2]),
        y: Number(startCommand[startCommand.length - 1]),
      };
      const end = {
        x: Number(lastDrawable[lastDrawable.length - 2]),
        y: Number(lastDrawable[lastDrawable.length - 1]),
      };

      return {
        type: typeof firstObject?.type === 'string' ? firstObject.type.toLowerCase() : null,
        vectorPathClosed: firstObject?.vectorPathClosed,
        start,
        end,
        path,
        closed:
          path.some((command) => Array.isArray(command) && String(command[0]).toUpperCase() === 'Z') ||
          (Math.abs(start.x - end.x) <= 0.0001 && Math.abs(start.y - end.y) <= 0.0001),
      };
    });
  };

  try {
    await expect.poll(async () => (await readSavedPathState())?.closed ?? null, { timeout: 10000 }).toBe(true);
  } catch {
    const savedState = await readSavedPathState();
    throw new Error(`Circle path stayed open after anchor drag: ${JSON.stringify(savedState)}`);
  }

  await expect(await readSavedPathState()).toMatchObject({
    type: 'path',
    closed: true,
  });
});
