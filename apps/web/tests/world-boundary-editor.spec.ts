import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

type WorldBoundarySnapshot = {
  enabled: boolean;
  pointCount: number;
} | null;

async function openWorldBoundaryEditor(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);
    const sceneId = useProjectStore.getState().project?.scenes?.[0]?.id ?? null;
    if (!sceneId) {
      throw new Error('Expected a scene before opening the world boundary editor.');
    }
    useEditorStore.getState().openWorldBoundaryEditor(sceneId);
  });

  await expect(page.getByTestId('world-boundary-editor-root')).toBeVisible();
  await expect(page.locator('#world-boundary-editor-stage')).toBeVisible();
}

async function closeWorldBoundaryEditor(page: Page): Promise<void> {
  const root = page.getByTestId('world-boundary-editor-root');
  await root.getByRole('button', { name: /^exit fullscreen$/i }).click();
  await expect(root).toBeHidden();
}

async function readWorldBoundaryState(page: Page): Promise<WorldBoundarySnapshot> {
  return page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const scene = useProjectStore.getState().project?.scenes?.[0];
    const boundary = scene?.worldBoundary;
    if (!boundary) {
      return null;
    }

    return {
      enabled: !!boundary.enabled,
      pointCount: Array.isArray(boundary.points) ? boundary.points.length : 0,
    };
  });
}

async function dispatchWorldBoundaryShortcut(
  page: Page,
  shortcut: 'undo' | 'redo',
): Promise<void> {
  await page.evaluate((mode) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: mode === 'redo',
      bubbles: true,
      cancelable: true,
    }));
  }, shortcut);
}

test.describe('World boundary editor', () => {
  test('hover help renders above the fullscreen editor chrome', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `World Boundary Help ${Date.now()}` });

    await openWorldBoundaryEditor(page);
    await page.getByRole('button', { name: /^boundary help$/i }).hover();
    await expect(page.getByRole('dialog').filter({ hasText: 'Click to place the first points.' })).toBeVisible();
  });

  test('undo and redo inside the fullscreen editor use the universal history timeline', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `World Boundary ${Date.now()}` });
    const baselineState = {
      enabled: false,
      pointCount: 0,
    };
    await expect.poll(async () => readWorldBoundaryState(page)).toEqual(baselineState);

    await openWorldBoundaryEditor(page);
    await page.getByRole('button', { name: /^clear boundary$/i }).click();

    await expect.poll(async () => readWorldBoundaryState(page)).toEqual({
      enabled: false,
      pointCount: 4,
    });

    await dispatchWorldBoundaryShortcut(page, 'undo');
    await expect(page.locator('#world-boundary-editor-stage')).toBeVisible();
    await expect.poll(async () => readWorldBoundaryState(page)).toEqual(baselineState);

    await dispatchWorldBoundaryShortcut(page, 'redo');
    await expect(page.locator('#world-boundary-editor-stage')).toBeVisible();
    await expect.poll(async () => readWorldBoundaryState(page)).toEqual({
      enabled: false,
      pointCount: 4,
    });
  });

  test('closing the editor keeps committed world boundary edits', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `World Boundary Close ${Date.now()}` });
    const baselineState = {
      enabled: false,
      pointCount: 0,
    };
    await expect.poll(async () => readWorldBoundaryState(page)).toEqual(baselineState);

    await openWorldBoundaryEditor(page);
    await page.getByRole('button', { name: /^clear boundary$/i }).click();
    await expect.poll(async () => readWorldBoundaryState(page)).toEqual({
      enabled: false,
      pointCount: 4,
    });

    await closeWorldBoundaryEditor(page);
    await expect(page.locator('#world-boundary-editor-stage')).toBeHidden();
    await expect.poll(async () => readWorldBoundaryState(page)).toEqual({
      enabled: false,
      pointCount: 4,
    });
  });
});
