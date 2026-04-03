import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

const PRIMARY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0s0AAAAASUVORK5CYII=';

const SELECTION_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

async function seedCostumes(page: Page): Promise<void> {
  await page.evaluate(async ({ baseAssetId }) => {
    const [{ useProjectStore }, { useEditorStore }, { createBitmapCostumeDocument }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
      import('/src/lib/costume/costumeDocument.ts'),
    ]);

    const { selectedSceneId, selectedObjectId } = useEditorStore.getState();
    const { updateObject } = useProjectStore.getState();
    if (!selectedSceneId || !selectedObjectId) {
      throw new Error('Expected a selected object before seeding costumes.');
    }

    const makeDataUrl = (fill: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d');
      if (!context) {
        return baseAssetId;
      }
      context.fillStyle = fill;
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    };

    updateObject(selectedSceneId, selectedObjectId, {
      costumes: [
        {
          id: 'costume-idle',
          name: 'Idle',
          assetId: makeDataUrl('#ef4444'),
          document: createBitmapCostumeDocument(makeDataUrl('#ef4444'), 'Idle Layer'),
        },
        {
          id: 'costume-walk',
          name: 'Walk',
          assetId: makeDataUrl('#22c55e'),
          document: createBitmapCostumeDocument(makeDataUrl('#22c55e'), 'Walk Layer'),
        },
        {
          id: 'costume-jump',
          name: 'Jump',
          assetId: makeDataUrl('#3b82f6'),
          document: createBitmapCostumeDocument(makeDataUrl('#3b82f6'), 'Jump Layer'),
        },
      ],
      currentCostumeIndex: 0,
    });
  }, { baseAssetId: PRIMARY_PNG_DATA_URL });
}

async function seedSounds(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

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

    const { selectedSceneId, selectedObjectId } = useEditorStore.getState();
    const { updateObject } = useProjectStore.getState();
    if (!selectedSceneId || !selectedObjectId) {
      throw new Error('Expected a selected object before seeding sounds.');
    }

    updateObject(selectedSceneId, selectedObjectId, {
      sounds: [
        { id: 'sound-ping', name: 'Ping', assetId: createSilentWavDataUrl(), duration: 0.1 },
        { id: 'sound-pop', name: 'Pop', assetId: createSilentWavDataUrl(), duration: 0.1 },
        { id: 'sound-bell', name: 'Bell', assetId: createSilentWavDataUrl(), duration: 0.1 },
      ],
    });
  });
}

async function dragTileToLowerHalf(source: Locator, target: Locator): Promise<void> {
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  if (!targetBox) {
    throw new Error('Target tile is missing a bounding box.');
  }

  await source.dragTo(target, {
    targetPosition: {
      x: Math.max(8, Math.round(targetBox.width / 2)),
      y: Math.max(8, Math.round(targetBox.height - 6)),
    },
  });
}

test.describe('asset sidebar interactions', () => {
  test('costume sidebar supports command selection and grouped drag reorder while keeping one active costume', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Costume Sidebar ${Date.now()}`,
      addObject: true,
    });

    await page.getByRole('radio', { name: /^costumes?$/i }).click();
    await seedCostumes(page);

    const tiles = page.getByTestId('costume-list-tile');
    await expect(tiles).toHaveCount(3);

    const idleTile = tiles.filter({ hasText: 'Idle' });
    const walkTile = tiles.filter({ hasText: 'Walk' });
    const jumpTile = tiles.filter({ hasText: 'Jump' });

    await idleTile.click();
    await walkTile.click({ modifiers: [SELECTION_MODIFIER] });

    await expect(idleTile).toHaveAttribute('data-active', 'true');
    await expect(idleTile).toHaveAttribute('data-selected', 'true');
    await expect(walkTile).toHaveAttribute('data-active', 'false');
    await expect(walkTile).toHaveAttribute('data-selected', 'true');

    await dragTileToLowerHalf(walkTile, jumpTile);

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes[0]?.objects[0];
        return {
          names: object?.costumes.map((costume) => costume.name) ?? [],
          activeCostumeId: object?.costumes[object.currentCostumeIndex]?.id ?? null,
        };
      });
    }).toEqual({
      names: ['Jump', 'Idle', 'Walk'],
      activeCostumeId: 'costume-idle',
    });
  });

  test('sound sidebar supports grouped reorder and bulk delete with a single active sound', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Sound Sidebar ${Date.now()}`,
      addObject: true,
    });

    await page.getByRole('radio', { name: /^sounds?$/i }).click();
    await seedSounds(page);

    const tiles = page.getByTestId('sound-list-tile');
    await expect(tiles).toHaveCount(3);

    const pingTile = tiles.filter({ hasText: 'Ping' });
    const popTile = tiles.filter({ hasText: 'Pop' });
    const bellTile = tiles.filter({ hasText: 'Bell' });

    await pingTile.click();
    await popTile.click({ modifiers: [SELECTION_MODIFIER] });

    await expect(pingTile).toHaveAttribute('data-active', 'true');
    await expect(pingTile).toHaveAttribute('data-selected', 'true');
    await expect(popTile).toHaveAttribute('data-selected', 'true');

    await dragTileToLowerHalf(popTile, bellTile);

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes[0]?.objects[0];
        return object?.sounds.map((sound) => sound.name) ?? [];
      });
    }).toEqual(['Bell', 'Ping', 'Pop']);

    await popTile.click({ button: 'right' });
    await page.getByRole('button', { name: /delete selected/i }).click();

    await expect.poll(async () => {
      return await page.evaluate(async () => {
        const { useProjectStore } = await import('/src/store/projectStore.ts');
        const project = useProjectStore.getState().project;
        const object = project?.scenes[0]?.objects[0];
        return object?.sounds.map((sound) => sound.name) ?? [];
      });
    }).toEqual(['Bell']);

    await expect(page.getByTestId('sound-list-tile')).toHaveCount(1);
    await expect(page.getByTestId('sound-list-tile').first()).toHaveAttribute('data-active', 'true');
  });
});
