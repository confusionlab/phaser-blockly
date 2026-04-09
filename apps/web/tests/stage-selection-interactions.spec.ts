import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

type StageClientPoint = {
  x: number;
  y: number;
};

type StageSelectionSnapshot = {
  selectedObjectId: string | null;
  selectedObjectIds: string[];
};

async function waitForStageReady(page: Page): Promise<void> {
  await expect(page.getByTestId('stage-phaser-host')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="stage-phaser-host"] canvas').first()).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => page.evaluate(() => Boolean(window['__pochaStageDebug']))).toBe(true);
  await waitForAnimationFrames(page, 2);
}

async function waitForAnimationFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frameCount) => {
    await new Promise<void>((resolve) => {
      let remaining = frameCount;
      const tick = () => {
        if (remaining <= 0) {
          resolve();
          return;
        }
        remaining -= 1;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, count);
}

async function seedStageObjects(
  page: Page,
  positions: Array<{ name: string; x: number; y: number }>,
): Promise<Array<{ id: string; name: string; x: number; y: number }>> {
  const objects = await page.evaluate(async (seedPositions) => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    const sceneId = useEditorStore.getState().selectedSceneId;
    if (!sceneId) {
      throw new Error('No selected scene was available for stage seeding.');
    }

    const projectState = useProjectStore.getState();
    const created = seedPositions.map((position) => {
      const nextObject = projectState.addObject(sceneId, position.name);
      projectState.updateObject(sceneId, nextObject.id, { x: position.x, y: position.y });
      return {
        id: nextObject.id,
        name: position.name,
        x: position.x,
        y: position.y,
      };
    });
    useEditorStore.getState().clearSelection();
    return created;
  }, positions);

  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

  return objects;
}

async function getStagePointForObject(page: Page, objectId: string): Promise<StageClientPoint> {
  const point = await page.evaluate(async (targetObjectId) => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    const debug = window['__pochaStageDebug'];
    const host = document.querySelector('[data-testid="stage-phaser-host"]');
    if (!(host instanceof HTMLElement) || !debug) {
      return null;
    }

    const project = useProjectStore.getState().project;
    const selectedSceneId = useEditorStore.getState().selectedSceneId;
    const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
    const object = scene?.objects.find((candidate) => candidate.id === targetObjectId);
    const cameraWorldView = debug.getEditorSceneSnapshot()?.cameraWorldView;
    if (!project || !object || !cameraWorldView) {
      return null;
    }

    const hostRect = host.getBoundingClientRect();
    const phaserX = object.x + (project.settings.canvasWidth / 2);
    const phaserY = (project.settings.canvasHeight / 2) - object.y;
    return {
      x: hostRect.x + (((phaserX - cameraWorldView.left) / cameraWorldView.width) * hostRect.width),
      y: hostRect.y + (((phaserY - cameraWorldView.top) / cameraWorldView.height) * hostRect.height),
    };
  }, objectId);

  if (!point) {
    throw new Error(`Could not resolve a stage point for object ${objectId}.`);
  }

  return point;
}

async function getStageEmptyPoint(page: Page): Promise<StageClientPoint> {
  const point = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="stage-phaser-host"]');
    if (!(host instanceof HTMLElement)) {
      return null;
    }
    const rect = host.getBoundingClientRect();
    return {
      x: rect.x + rect.width - 48,
      y: rect.y + rect.height - 48,
    };
  });

  if (!point) {
    throw new Error('Could not resolve an empty stage point.');
  }

  return point;
}

async function getSelectionSnapshot(page: Page): Promise<StageSelectionSnapshot> {
  return page.evaluate(async () => {
    const [{ useEditorStore }] = await Promise.all([
      import('/src/store/editorStore.ts'),
    ]);
    return {
      selectedObjectId: useEditorStore.getState().selectedObjectId,
      selectedObjectIds: [...useEditorStore.getState().selectedObjectIds],
    };
  });
}

async function getObjectPosition(page: Page, objectId: string): Promise<{ x: number; y: number }> {
  const position = await page.evaluate(async (targetObjectId) => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    const project = useProjectStore.getState().project;
    const selectedSceneId = useEditorStore.getState().selectedSceneId;
    const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
    const object = scene?.objects.find((candidate) => candidate.id === targetObjectId);
    return object ? { x: object.x, y: object.y } : null;
  }, objectId);

  if (!position) {
    throw new Error(`Could not resolve store position for object ${objectId}.`);
  }

  return position;
}

async function getLiveObjectSnapshot(
  page: Page,
  objectId: string,
): Promise<{ x: number; y: number; scaleX: number; scaleY: number; rotation: number }> {
  const snapshot = await page.evaluate((targetObjectId) => {
    const debug = window['__pochaStageDebug'];
    return debug?.getEditorObjectSnapshot?.(targetObjectId) ?? null;
  }, objectId);

  if (!snapshot) {
    throw new Error(`Could not resolve live stage state for object ${objectId}.`);
  }

  return snapshot;
}

test.describe('Stage selection interactions', () => {
  test('click selects, empty stage deselects, and dragging moves the selected object', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Select Drag ${Date.now()}`,
    });
    await waitForStageReady(page);

    const [firstObject] = await seedStageObjects(page, [
      { name: 'Object 1', x: -120, y: 0 },
    ]);

    const objectPoint = await getStagePointForObject(page, firstObject.id);
    const emptyPoint = await getStageEmptyPoint(page);

    await page.mouse.click(objectPoint.x, objectPoint.y);
    await expect.poll(() => getSelectionSnapshot(page)).toEqual({
      selectedObjectId: firstObject.id,
      selectedObjectIds: [firstObject.id],
    });

    const startPosition = await getObjectPosition(page, firstObject.id);
    await page.mouse.move(objectPoint.x, objectPoint.y);
    await page.mouse.down();
    await page.mouse.move(objectPoint.x + 90, objectPoint.y + 54, { steps: 12 });
    await page.mouse.up();

    await expect.poll(() => getObjectPosition(page, firstObject.id)).not.toEqual(startPosition);

    await page.mouse.click(emptyPoint.x, emptyPoint.y);
    await expect.poll(() => getSelectionSnapshot(page)).toEqual({
      selectedObjectId: null,
      selectedObjectIds: [],
    });
  });

  test('dragging preserves the live stage position until mouse-up commit', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Drag Live Position ${Date.now()}`,
    });
    await waitForStageReady(page);

    const [firstObject] = await seedStageObjects(page, [
      { name: 'Object 1', x: -120, y: 0 },
    ]);

    const objectPoint = await getStagePointForObject(page, firstObject.id);
    const startPosition = await getObjectPosition(page, firstObject.id);
    const startLiveSnapshot = await getLiveObjectSnapshot(page, firstObject.id);

    await page.mouse.move(objectPoint.x, objectPoint.y);
    await page.mouse.down();
    await page.mouse.move(objectPoint.x + 120, objectPoint.y + 72, { steps: 16 });
    await waitForAnimationFrames(page, 4);

    const liveDuringDrag = await getLiveObjectSnapshot(page, firstObject.id);
    expect(Math.abs(liveDuringDrag.x - startLiveSnapshot.x)).toBeGreaterThan(40);
    expect(Math.abs(liveDuringDrag.y - startLiveSnapshot.y)).toBeGreaterThan(20);
    await expect(getObjectPosition(page, firstObject.id)).resolves.toEqual(startPosition);

    await page.mouse.up();

    await expect.poll(() => getObjectPosition(page, firstObject.id)).not.toEqual(startPosition);
  });

  test('dragging across empty stage creates a marquee selection', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Marquee ${Date.now()}`,
    });
    await waitForStageReady(page);

    const [leftObject, rightObject] = await seedStageObjects(page, [
      { name: 'Object 1', x: -160, y: 0 },
      { name: 'Object 2', x: 160, y: 0 },
    ]);

    const leftPoint = await getStagePointForObject(page, leftObject.id);
    const rightPoint = await getStagePointForObject(page, rightObject.id);
    const marqueeStart = {
      x: Math.min(leftPoint.x, rightPoint.x) - 80,
      y: Math.min(leftPoint.y, rightPoint.y) - 80,
    };
    const marqueeEnd = {
      x: Math.max(leftPoint.x, rightPoint.x) + 80,
      y: Math.max(leftPoint.y, rightPoint.y) + 80,
    };

    await page.mouse.move(marqueeStart.x, marqueeStart.y);
    await page.mouse.down();
    await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => {
      const selection = await getSelectionSnapshot(page);
      return [...selection.selectedObjectIds].sort();
    }).toEqual([leftObject.id, rightObject.id].sort());
  });
});
