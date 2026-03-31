import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function addSoundToSelectedObject(page: Page, name: string): Promise<void> {
  await page.evaluate(({ soundName }) => {
    const createSilentWavDataUrl = () => {
      const sampleRate = 8_000;
      const durationSeconds = 0.1;
      const frameCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
      const bytesPerSample = 2;
      const blockAlign = bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const dataSize = frameCount * bytesPerSample;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);

      const writeAscii = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };

      writeAscii(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeAscii(8, 'WAVE');
      writeAscii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeAscii(36, 'data');
      view.setUint32(40, dataSize, true);

      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return `data:audio/wav;base64,${btoa(binary)}`;
    };

    return Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]).then(([{ useProjectStore }, { useEditorStore }]) => {
      const { selectedSceneId, selectedObjectId } = useEditorStore.getState();
      const { project, updateObject } = useProjectStore.getState();
      if (!selectedSceneId || !selectedObjectId || !project) {
        throw new Error('No selected object was available for seeding a sound.');
      }

      const scene = project.scenes.find((candidate) => candidate.id === selectedSceneId);
      const object = scene?.objects.find((candidate) => candidate.id === selectedObjectId);
      if (!object) {
        throw new Error('The selected object could not be found.');
      }

      updateObject(selectedSceneId, selectedObjectId, {
        sounds: [
          ...object.sounds,
          {
            id: crypto.randomUUID(),
            name: soundName,
            assetId: createSilentWavDataUrl(),
            duration: 0.1,
          },
        ],
      });
    });
  }, { soundName: name });
}

test.describe('Keyboard shortcuts', () => {
  test('backquote uses the stage fullscreen overlay instead of the legacy stage shell', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Shortcut ${Date.now()}`,
    });

    const stagePanel = page.locator('[data-editor-panel="stage"]');
    await expect(stagePanel).toBeVisible();

    const panelBox = await stagePanel.boundingBox();
    expect(panelBox).not.toBeNull();
    if (!panelBox) {
      throw new Error('Stage panel bounding box was not available.');
    }

    await page.mouse.click(
      panelBox.x + panelBox.width / 2,
      panelBox.y + Math.min(panelBox.height / 2, 220),
    );
    await page.keyboard.press('Backquote');

    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
    await expect(page.getByText('Stage (Press ` or Esc to exit)')).toHaveCount(0);

    await page.keyboard.press('Backquote');

    await expect(page.getByRole('button', { name: 'Fullscreen stage' })).toBeVisible();
  });

  test('rename inputs suppress editor shortcuts and escape cancels rename', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Keyboard Test ${Date.now()}`,
      addObject: true,
    });

    await expect(page.getByText(/^Object 1$/)).toBeVisible();

    await page.getByText(/^Object 1$/).dblclick();
    const renameInput = page.locator('input[value="Object 1"]').first();
    await expect(renameInput).toBeVisible();

    await renameInput.fill('Renamed Object');
    await page.keyboard.press('ControlOrMeta+D');

    await expect(page.getByText(/^Object 2$/)).toHaveCount(0);

    await page.keyboard.press('Escape');

    await expect(page.getByText(/^Object 1$/)).toBeVisible();
    await expect(page.getByText(/^Renamed Object$/)).toHaveCount(0);
  });

  test('the stage keyboard surface restores scene-object shortcuts', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Focus Shortcut ${Date.now()}`,
      addObject: true,
    });

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toBeVisible();
    await projectNameDisplay.click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();

    const stageShortcutSurface = page.locator('[data-editor-panel="stage"] [data-editor-shortcut-surface="scene-objects"]').first();
    await expect(stageShortcutSurface).toBeVisible();
    await stageShortcutSurface.focus();
    await page.keyboard.press('ControlOrMeta+D');

    await expect(page.getByText(/^Object 1 Copy$/)).toBeVisible();
  });

  test('clicking the object shelf restores copy, paste, and cut shortcuts', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Shelf Focus Shortcut ${Date.now()}`,
      addObject: true,
    });

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toBeVisible();
    await projectNameDisplay.click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();

    const objectRow = page.getByText(/^Object 1$/).first();
    await expect(objectRow).toBeVisible();
    await objectRow.click();

    await page.keyboard.press('ControlOrMeta+C');
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByText(/^Object 1 Copy$/)).toBeVisible();

    await page.keyboard.press('ControlOrMeta+X');
    await expect(page.getByText(/^Object 1 Copy$/)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByText(/^Object 1 Copy$/)).toBeVisible();
  });

  test('project name escape cancels without saving blur side effects', async ({ page }) => {
    const projectName = `Keyboard Test ${Date.now()}`;
    await bootstrapEditorProject(page, { projectName });

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toHaveText(projectName);
    await projectNameDisplay.click();

    const renameInput = page.getByRole('textbox', { name: 'Project name' });
    await expect(renameInput).toBeVisible();
    const originalName = await renameInput.inputValue();
    expect(originalName).toBeTruthy();

    await renameInput.fill('Should Not Save');
    await page.keyboard.press('Escape');

    await expect(projectNameDisplay).toHaveText(originalName ?? '');
    await expect(page.getByText(/^Should Not Save$/)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveCount(0);
  });

  test('project name first click places the caret at the end', async ({ page }) => {
    const projectName = `Caret Placement ${Date.now()}`;
    await bootstrapEditorProject(page, { projectName });

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toHaveText(projectName);
    await projectNameDisplay.click({ position: { x: 6, y: 6 } });

    const renameInput = page.getByRole('textbox', { name: 'Project name' });
    await expect(renameInput).toBeVisible();

    const selection = await renameInput.evaluate((input) => ({
      end: input.selectionEnd,
      length: input.value.length,
      start: input.selectionStart,
    }));

    expect(selection.start).toBe(selection.length);
    expect(selection.end).toBe(selection.length);
  });

  test('project name edit enforces the max length before commit', async ({ page }) => {
    const projectName = `Project Limit ${Date.now()}`;
    await bootstrapEditorProject(page, { projectName });

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toHaveText(projectName);
    await projectNameDisplay.click();

    const renameInput = page.getByRole('textbox', { name: 'Project name' });
    await expect(renameInput).toBeVisible();

    const longName = 'x'.repeat(200);
    await renameInput.fill(longName);

    const value = await renameInput.inputValue();
    expect(value.length).toBe(120);

    await page.keyboard.press('Enter');
    await expect(projectNameDisplay).toHaveText('x'.repeat(120));
  });

  test('costume sidebar tile names stay plain until double-click rename starts', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Costume Tile Rename ${Date.now()}`,
      addObject: true,
    });

    await page.getByRole('radio', { name: /^costume$/i }).click();

    const costumeTile = page.locator('[data-slot="card"]').first();
    const costumeTileName = page.getByText(/^costume1$/i).first();
    await expect(costumeTileName).toBeVisible();

    await costumeTileName.click();
    await expect(page.getByRole('textbox', { name: 'Rename costume1' })).toHaveCount(0);

    const beforeRenameBox = await costumeTile.boundingBox();
    expect(beforeRenameBox).not.toBeNull();

    await costumeTileName.dblclick();

    const renameInput = page.getByRole('textbox', { name: 'Rename costume1' });
    await expect(renameInput).toBeVisible();

    const afterRenameBox = await costumeTile.boundingBox();
    expect(afterRenameBox).not.toBeNull();
    expect(Math.abs((afterRenameBox?.height ?? 0) - (beforeRenameBox?.height ?? 0))).toBeLessThanOrEqual(1);

    await renameInput.fill('Hero Idle');
    await renameInput.press('Enter');

    await expect(page.getByText(/^Hero Idle$/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Rename Hero Idle' })).toHaveCount(0);
  });

  test('sound sidebar tile names stay plain until double-click rename starts', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Sound Tile Rename ${Date.now()}`,
      addObject: true,
    });
    await addSoundToSelectedObject(page, 'Intro Sound');

    await page.getByRole('radio', { name: /^sound$/i }).click();

    const soundTileName = page.getByText(/^Intro Sound$/).first();
    await expect(soundTileName).toBeVisible();

    await soundTileName.click();
    await expect(page.getByRole('textbox', { name: 'Rename Intro Sound' })).toHaveCount(0);

    await soundTileName.dblclick();

    const renameInput = page.getByRole('textbox', { name: 'Rename Intro Sound' });
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Ambient Loop');
    await renameInput.press('Enter');

    await expect(page.getByText(/^Ambient Loop$/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Rename Ambient Loop' })).toHaveCount(0);
  });
});
