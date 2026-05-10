import { expect, test, type Page } from '@playwright/test';
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
  const editor = page.getByTestId('scratch-paint-costume-editor');
  const canvases = editor.locator('canvas');
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
  await page.getByTestId('scratch-paint-costume-editor').getByRole('button', { name: /^Brush$/ }).click();
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

test('preserves Scratch Paint vector source while keeping a normal runtime bitmap', async ({ page }) => {
  await openCostumeTab(page, `Scratch Vector Source ${Date.now()}`, 'scratch');

  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('scratch-paint-costume-editor').getByRole('button', { name: /convert to vector/i }).click();

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

test('Scratch Paint vector costumes keep their native editor when the default is Pocha', async ({ page }) => {
  await openCostumeTab(page, `Scratch Native Routing ${Date.now()}`, 'scratch');

  await expect(page.getByTestId('scratch-paint-costume-editor')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('scratch-paint-costume-editor').getByRole('button', { name: /convert to vector/i }).click();

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
