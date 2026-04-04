import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openBackgroundEditor(page: Page) {
  const sceneRadio = page.getByRole('radio', { name: /^scenes?$/i });
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
  return { root, box };
}

async function closeBackgroundEditor(page: Page): Promise<void> {
  const root = page.getByTestId('background-editor-root');
  await root.getByRole('button', { name: /^exit fullscreen$/i }).click();
  await expect(root).toBeHidden();
}

async function readPlayCanvasDarkPixelCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const host = document.querySelector('[data-testid="play-phaser-host"]');
    const canvas = host?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('Failed to decode play canvas image.'));
      nextImage.src = canvas.toDataURL('image/png');
    });

    const probe = document.createElement('canvas');
    probe.width = image.naturalWidth || image.width;
    probe.height = image.naturalHeight || image.height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    ctx.drawImage(image, 0, 0, probe.width, probe.height);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    let darkPixels = 0;
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

    return darkPixels;
  });
}

async function addVectorLayer(page: Page): Promise<void> {
  await page.getByTestId('layer-add-button').click();
  await page.getByRole('menuitem', { name: /^vector$/i }).click();
}

async function reopenCurrentProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ loadProject, saveProject }, { useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/db/database.ts'),
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    const project = useProjectStore.getState().project;
    if (!project) {
      throw new Error('Missing project to reopen.');
    }

    await saveProject(project);
    const reloadedProject = await loadProject(project.id);
    if (!reloadedProject) {
      throw new Error('Failed to reload saved project.');
    }

    useProjectStore.getState().openProject(reloadedProject);
    const firstSceneId = reloadedProject.scenes[0]?.id ?? null;
    useEditorStore.getState().selectScene(firstSceneId, { recordHistory: false });
  });
}

test.describe('play mode background runtime', () => {
  test('bitmap backgrounds remain visible after entering play mode', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Play Background ${Date.now()}` });
    const editor = await openBackgroundEditor(page);

    const startX = editor.box.x + editor.box.width * 0.44;
    const startY = editor.box.y + editor.box.height * 0.44;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + editor.box.width * 0.08, startY + editor.box.height * 0.06, { steps: 8 });
    await page.mouse.up();

    await closeBackgroundEditor(page);
    await expect(editor.root).toBeHidden();

    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      useEditorStore.getState().startPlaying();
    });

    await expect(page.getByTestId('play-phaser-host')).toBeVisible();
    await expect.poll(async () => readPlayCanvasDarkPixelCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('bitmap backgrounds remain visible in play mode after saving and reopening', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Play Background Reload ${Date.now()}` });
    const editor = await openBackgroundEditor(page);

    const startX = editor.box.x + editor.box.width * 0.44;
    const startY = editor.box.y + editor.box.height * 0.44;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + editor.box.width * 0.08, startY + editor.box.height * 0.06, { steps: 8 });
    await page.mouse.up();

    await closeBackgroundEditor(page);
    await expect(editor.root).toBeHidden();

    await reopenCurrentProject(page);

    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      useEditorStore.getState().startPlaying();
    });

    await expect(page.getByTestId('play-phaser-host')).toBeVisible();
    await expect.poll(async () => readPlayCanvasDarkPixelCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('vector backgrounds remain visible after entering play mode', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Play Background ${Date.now()}` });
    const editor = await openBackgroundEditor(page);
    await addVectorLayer(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    const startX = editor.box.x + editor.box.width * 0.42;
    const startY = editor.box.y + editor.box.height * 0.42;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + editor.box.width * 0.14, startY + editor.box.height * 0.12, { steps: 8 });
    await page.mouse.up();

    await closeBackgroundEditor(page);
    await expect(editor.root).toBeHidden();

    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      useEditorStore.getState().startPlaying();
    });

    await expect(page.getByTestId('play-phaser-host')).toBeVisible();
    await expect.poll(async () => readPlayCanvasDarkPixelCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('image backgrounds remain visible after entering play mode', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Play Background ${Date.now()}` });

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const project = useProjectStore.getState().project;
      const sceneId = project?.scenes[0]?.id;
      if (!sceneId) {
        throw new Error('Missing scene id.');
      }

      const backgroundImage = (() => {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to create image background canvas.');
        }
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      })();

      useProjectStore.getState().updateScene(sceneId, {
        background: {
          type: 'image',
          value: backgroundImage,
          version: 1,
        },
      });
    });

    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      useEditorStore.getState().startPlaying();
    });

    await expect(page.getByTestId('play-phaser-host')).toBeVisible();
    await expect.poll(async () => readPlayCanvasDarkPixelCount(page), { timeout: 10000 }).toBeGreaterThan(0);
  });
});
