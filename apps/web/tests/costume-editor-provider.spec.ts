import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openCostumeTab(
  page: Page,
  projectName: string,
  provider: 'pocha' | 'scratch' = 'pocha',
): Promise<void> {
  await bootstrapEditorProject(page, {
    projectName,
    addObject: true,
  });

  await page.evaluate(async (editorProvider) => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);
    window.localStorage.setItem('pochacoding:costume-editor-provider', editorProvider);
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    const sceneId = project?.scenes[0]?.id ?? null;
    if (!sceneId) {
      throw new Error('Expected a scene before opening the costume editor.');
    }

    const scene = project?.scenes.find((candidate) => candidate.id === sceneId);
    const object = scene?.objects[0] ?? projectState.addObject(sceneId, 'Object 1');
    useEditorStore.getState().selectScene(sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(object.id, { recordHistory: false });
  }, provider);

  await expect.poll(async () => {
    return await page.evaluate(async () => {
      const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
        import('/src/store/projectStore.ts'),
        import('/src/store/editorStore.ts'),
      ]);
      const project = useProjectStore.getState().project;
      const selectedObjectId = useEditorStore.getState().selectedObjectId;
      const selectedSceneId = useEditorStore.getState().selectedSceneId;
      const object = project?.scenes
        .find((scene) => scene.id === selectedSceneId)
        ?.objects.find((candidate) => candidate.id === selectedObjectId);
      return Boolean(object);
    });
  }, { timeout: 10000 }).toBe(true);

  const costumeTab = page.getByRole('radio', { name: /^costumes?$/i });
  await expect(costumeTab).toBeVisible({ timeout: 10000 });
  await costumeTab.click();
}

async function readActiveCostumeAssetId(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const scene = project?.scenes[0];
    const object = scene?.objects[0];
    const costume = object?.costumes[object.currentCostumeIndex ?? 0];
    return costume?.assetId ?? null;
  });
}

async function readActiveCostumeId(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const scene = project?.scenes[0];
    const object = scene?.objects[0];
    const costume = object?.costumes[object.currentCostumeIndex ?? 0];
    return costume?.id ?? null;
  });
}

async function readActiveCostumeDocumentSummary(page: Page): Promise<{
  kind: string | null;
  layerKind: string | null;
  layerAssetId: string | null;
  editorSourceEngine: string | null;
  editorSourceFormat: string | null;
  editorSourceText: string | null;
}> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const scene = project?.scenes[0];
    const object = scene?.objects[0];
    const costume = object?.costumes[object.currentCostumeIndex ?? 0];
    const layer = costume?.document.layers.find((candidate) => candidate.id === costume.document.activeLayerId)
      ?? costume?.document.layers[0]
      ?? null;
    return {
      kind: costume?.kind ?? null,
      layerKind: layer?.kind ?? null,
      layerAssetId: layer?.kind === 'bitmap' ? layer.bitmap.assetId : null,
      editorSourceEngine: costume?.kind === 'static' ? costume.editorSource?.engine ?? null : null,
      editorSourceFormat: costume?.kind === 'static' ? costume.editorSource?.format ?? null : null,
      editorSourceText: costume?.kind === 'static' ? costume.editorSource?.source ?? null : null,
    };
  });
}

async function getScratchPaintCanvasBox(page: Page) {
  const canvases = getScratchPaintFrame(page).locator('canvas');
  await expect.poll(async () => await canvases.count(), { timeout: 20000 }).toBeGreaterThan(0);

  const count = await canvases.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const canvas = canvases.nth(index);
    const box = await canvas.boundingBox();
    if (box && box.width > 100 && box.height > 100) {
      return box;
    }
  }

  throw new Error('Scratch Paint canvas did not expose a drawable bounding box.');
}

function getScratchPaintFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="scratch-paint-frame"]');
}

async function chooseCostumeEditorFromMenu(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: /open workspace menu/i }).click();
  const search = page.getByRole('textbox', { name: /search workspace menu/i });
  await expect(search).toBeVisible();
  await search.fill(query);
  await search.press('Enter');
}

test('uses the Pocha costume editor by default', async ({ page }) => {
  await openCostumeTab(page, `Default Costume Provider ${Date.now()}`);

  await expect(page.getByTestId('pocha-costume-editor')).toBeVisible();
  await expect(page.getByTestId('scratch-paint-costume-editor')).toHaveCount(0);
});

test('can switch costume editors from the workspace menu', async ({ page }) => {
  await openCostumeTab(page, `Menu Costume Provider ${Date.now()}`);

  await expect(page.getByTestId('pocha-costume-editor')).toBeVisible();

  await chooseCostumeEditorFromMenu(page, 'Scratch Paint');
  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('pocha-costume-editor')).toHaveCount(0);

  await chooseCostumeEditorFromMenu(page, 'Pocha');
  await expect(page.getByTestId('pocha-costume-editor')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('scratch-paint-costume-editor')).toHaveCount(0);
});

test('can toggle Scratch Paint and commit through the normal costume document', async ({ page }) => {
  await openCostumeTab(page, `Scratch Costume Provider ${Date.now()}`, 'scratch');

  await expect.poll(async () => {
    return await page.evaluate(async () => {
      const { getCostumeEditorProvider } = await import('/src/lib/appVariant.ts');
      return getCostumeEditorProvider();
    });
  }, { timeout: 10000 }).toBe('scratch');

  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('pocha-costume-editor')).toHaveCount(0);

  const beforeAssetId = await readActiveCostumeAssetId(page);
  await getScratchPaintFrame(page).getByRole('button', { name: /^Brush$/ }).click();
  const canvasBox = await getScratchPaintCanvasBox(page);
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.35, canvasBox.y + canvasBox.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.65, canvasBox.y + canvasBox.height * 0.55, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => await readActiveCostumeAssetId(page), { timeout: 20000 }).not.toBe(beforeAssetId);

  const summary = await readActiveCostumeDocumentSummary(page);
  expect(summary.kind).toBe('static');
  expect(summary.layerKind).toBe('bitmap');
  expect(summary.layerAssetId).toMatch(/^data:image\/png;base64,/);
  expect(summary.editorSourceEngine).toBeNull();
});

test('keeps the Scratch Paint iframe mounted when switching costumes', async ({ page }) => {
  await openCostumeTab(page, `Scratch Costume Warm Frame ${Date.now()}`, 'scratch');

  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => await getScratchPaintFrame(page).locator('canvas').count(), { timeout: 20000 })
    .toBeGreaterThan(0);

  const iframe = page.getByTestId('scratch-paint-frame');
  await iframe.evaluate((node) => {
    (node as HTMLElement).dataset.mountToken = 'warm-frame';
  });

  const [firstCostumeId, secondCostumeId] = await page.evaluate(async () => {
    const [{ useProjectStore }, { cloneCostume }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/lib/costume/costumeDocument.ts'),
    ]);
    const projectStore = useProjectStore.getState();
    const project = projectStore.project;
    const scene = project?.scenes[0];
    const object = scene?.objects[0];
    const firstCostume = object?.costumes[object.currentCostumeIndex ?? 0];
    if (!scene || !object || !firstCostume) {
      throw new Error('Expected an object with a costume before switching Scratch Paint costumes.');
    }

    const secondCostume = cloneCostume(firstCostume);
    secondCostume.id = `scratch-warm-frame-${Date.now()}`;
    secondCostume.name = 'Warm Frame Second';
    projectStore.applyCostumeEditorOperation(
      { sceneId: scene.id, objectId: object.id },
      { operation: { type: 'add', costume: secondCostume }, recordHistory: false },
    );
    return [firstCostume.id, secondCostume.id];
  });

  await expect.poll(async () => await readActiveCostumeId(page), { timeout: 10000 }).toBe(secondCostumeId);
  await expect.poll(async () => await iframe.evaluate((node) => (node as HTMLElement).dataset.mountToken), {
    timeout: 10000,
  }).toBe('warm-frame');

  await page.evaluate(async (costumeId) => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const projectStore = useProjectStore.getState();
    const project = projectStore.project;
    const scene = project?.scenes[0];
    const object = scene?.objects[0];
    if (!scene || !object) {
      throw new Error('Expected an object before switching back to the first Scratch Paint costume.');
    }
    projectStore.applyCostumeEditorOperation(
      { sceneId: scene.id, objectId: object.id },
      { operation: { type: 'select', costumeId }, recordHistory: false },
    );
  }, firstCostumeId);

  await expect.poll(async () => await readActiveCostumeId(page), { timeout: 10000 }).toBe(firstCostumeId);
  await expect.poll(async () => await iframe.evaluate((node) => (node as HTMLElement).dataset.mountToken), {
    timeout: 10000,
  }).toBe('warm-frame');
});

test('preserves Scratch Paint vector source while keeping a normal runtime bitmap', async ({ page }) => {
  await openCostumeTab(page, `Scratch Vector Source ${Date.now()}`, 'scratch');

  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await getScratchPaintFrame(page).getByRole('button', { name: /convert to vector/i }).click();

  await expect.poll(async () => {
    const summary = await readActiveCostumeDocumentSummary(page);
    return summary.editorSourceEngine;
  }, { timeout: 20000 }).toBe('scratch-paint');

  const summary = await readActiveCostumeDocumentSummary(page);
  expect(summary.kind).toBe('static');
  expect(summary.layerKind).toBe('bitmap');
  expect(summary.layerAssetId).toMatch(/^data:image\/png;base64,/);
  expect(summary.editorSourceFormat).toBe('svg');
  expect(summary.editorSourceText).toContain('<svg');
});

test('Scratch Paint vector moves do not block the rest of the editor UI', async ({ page }) => {
  await openCostumeTab(page, `Scratch Vector Drag Release ${Date.now()}`, 'scratch');

  const editor = page.getByTestId('scratch-paint-costume-editor');
  await expect(editor).toBeVisible({ timeout: 20000 });
  const frame = getScratchPaintFrame(page);
  await frame.getByRole('button', { name: /convert to vector/i }).click();

  const canvasBox = await getScratchPaintCanvasBox(page);
  await frame.getByRole('button', { name: /^Rectangle$/i }).click();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.44, canvasBox.y + canvasBox.height * 0.44);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + canvasBox.height * 0.58, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => {
    const summary = await readActiveCostumeDocumentSummary(page);
    return summary.editorSourceText;
  }, { timeout: 20000 }).toContain('<svg');
  const sourceBeforeMove = (await readActiveCostumeDocumentSummary(page)).editorSourceText;
  expect(sourceBeforeMove).toBeTruthy();

  await frame.getByRole('button', { name: /^Select$/i }).click();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.51, canvasBox.y + canvasBox.height * 0.51);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.62, canvasBox.y + canvasBox.height * 0.6, { steps: 18 });
  await page.mouse.up();

  await expect.poll(async () => {
    const summary = await readActiveCostumeDocumentSummary(page);
    return summary.editorSourceText;
  }, { timeout: 20000 }).not.toBe(sourceBeforeMove);

  await page.getByRole('radio', { name: /^Code$/i }).click();
  await expect.poll(async () => {
    return await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      return useEditorStore.getState().activeObjectTab;
    });
  }, { timeout: 10000 }).toBe('code');

  await page.getByRole('button', { name: /open workspace menu/i }).click();
  await expect(page.getByRole('textbox', { name: /search workspace menu/i })).toBeVisible();
});

test('Scratch Paint vector costumes keep their native editor when the default is Pocha', async ({ page }) => {
  await openCostumeTab(page, `Scratch Native Routing ${Date.now()}`, 'scratch');

  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await getScratchPaintFrame(page).getByRole('button', { name: /convert to vector/i }).click();

  await expect.poll(async () => {
    const summary = await readActiveCostumeDocumentSummary(page);
    return summary.editorSourceEngine;
  }, { timeout: 20000 }).toBe('scratch-paint');

  await chooseCostumeEditorFromMenu(page, 'Pocha');

  await expect.poll(async () => {
    return await page.evaluate(async () => {
      const { getCostumeEditorProvider } = await import('/src/lib/appVariant.ts');
      return getCostumeEditorProvider();
    });
  }, { timeout: 10000 }).toBe('pocha');
  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('pocha-costume-editor')).toHaveCount(0);

  const summary = await readActiveCostumeDocumentSummary(page);
  expect(summary.editorSourceEngine).toBe('scratch-paint');
  expect(summary.layerKind).toBe('bitmap');
});

test('Scratch Paint More menu opens inside the frame', async ({ page }) => {
  const reactChildErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (/Objects are not valid as a React child|Portal/i.test(error.message)) {
      reactChildErrors.push(error.message);
    }
  });

  await openCostumeTab(page, `Scratch More Menu ${Date.now()}`, 'scratch');

  const frame = getScratchPaintFrame(page);
  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await frame.getByRole('button', { name: /convert to vector/i }).click();
  await frame.getByText('More').click();

  await expect(frame.locator('.Popover-body').filter({ hasText: 'Front' })).toBeVisible({ timeout: 10000 });
  expect(reactChildErrors).toEqual([]);
});
