import { expect, test } from '@playwright/test';

type BrowserRunResult = {
  result: {
    applied: boolean;
    changed: boolean;
    appliedOpCount: number;
    errors: string[];
    validationIssueCount: number;
  };
  project: {
    name: string;
    scenes: Array<{
      id: string;
      name: string;
      objects: Array<{
        id: string;
        name: string;
        x: number;
        visible: boolean;
        parentId: string | null;
        physics: { enabled: boolean; gravityY?: number } | null;
        collider: { type: string } | null;
        costumes: Array<{ id: string; name: string }>;
        currentCostumeIndex: number;
      }>;
      objectFolders: Array<{ id: string; name: string }>;
    }>;
  };
};

async function runProjectOpsInBrowser(
  page: import('@playwright/test').Page,
  projectOps: unknown[],
  fetchStatus?: number,
): Promise<BrowserRunResult> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  return page.evaluate(async ({ projectOps: ops, fetchStatusCode }) => {
    const { applyProjectOps } = await import('/src/lib/llm/projectOps.ts');

    const createScene = (id: string, name: string, order: number) => ({
      id,
      name,
      order,
      background: { type: 'color' as const, value: '#87CEEB' },
      objects: [],
      objectFolders: [],
      cameraConfig: {
        followTarget: null,
        bounds: null,
        zoom: 1,
      },
    });

    const createObject = (id: string, name: string, order: number) => ({
      id,
      name,
      spriteAssetId: null,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      visible: true,
      parentId: null,
      order,
      layer: order,
      folderId: null,
      physics: null,
      collider: null,
      blocklyXml: '',
      costumes: [
        {
          id: `${id}-costume-1`,
          name: 'idle',
          assetId: 'data:image/svg+xml;base64,PHN2Zy8+',
          editorMode: 'vector' as const,
        },
      ],
      currentCostumeIndex: 0,
      sounds: [],
      localVariables: [],
    });

    const scene1 = createScene('scene-1', 'Scene 1', 0);
    const scene2 = createScene('scene-2', 'Scene 2', 1);
    scene1.objects.push(createObject('object-1', 'Player', 0));
    scene1.objects.push(createObject('object-2', 'Enemy', 1));

    const state = {
      project: {
        id: 'project-1',
        name: 'Demo Project',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        schemaVersion: 6,
        scenes: [scene1, scene2],
        messages: [],
        globalVariables: [],
        settings: {
          canvasWidth: 800,
          canvasHeight: 600,
          backgroundColor: '#87CEEB',
        },
        components: [],
      },
      sceneCounter: 3,
      objectCounter: 3,
    };

    const findScene = (sceneId: string) => {
      const scene = state.project.scenes.find((item) => item.id === sceneId);
      if (!scene) {
        throw new Error(`Scene not found: ${sceneId}`);
      }
      return scene;
    };

    const bindings = {
      getProject: () => state.project,
      updateProjectName: (name: string) => {
        state.project.name = name;
      },
      addScene: (name: string) => {
        const scene = createScene(`scene-${state.sceneCounter}`, name, state.project.scenes.length);
        state.sceneCounter += 1;
        state.project.scenes.push(scene);
      },
      reorderScenes: (sceneIds: string[]) => {
        const byId = new Map(state.project.scenes.map((scene) => [scene.id, scene]));
        state.project.scenes = sceneIds
          .map((sceneId, index) => {
            const scene = byId.get(sceneId);
            return scene ? { ...scene, order: index } : null;
          })
          .filter((scene): scene is (typeof state.project.scenes)[number] => !!scene);
      },
      updateScene: (sceneId: string, updates: Record<string, unknown>) => {
        const scene = findScene(sceneId);
        Object.assign(scene, updates);
      },
      addObject: (sceneId: string, name: string) => {
        const scene = findScene(sceneId);
        const object = createObject(`object-${state.objectCounter}`, name, scene.objects.length);
        state.objectCounter += 1;
        scene.objects.push(object);
        return object;
      },
      updateObject: (sceneId: string, objectId: string, updates: Record<string, unknown>) => {
        const scene = findScene(sceneId);
        const object = scene.objects.find((item) => item.id === objectId);
        if (!object) {
          throw new Error(`Object not found: ${objectId}`);
        }
        Object.assign(object, updates);
      },
    };

    const originalFetch = globalThis.fetch;
    if (typeof fetchStatusCode === 'number') {
      globalThis.fetch = (async () => new Response('missing', { status: fetchStatusCode })) as typeof fetch;
    }

    try {
      const result = await applyProjectOps({
        projectOps: ops as never,
        bindings,
      });

      return {
        result: {
          applied: result.applied,
          changed: result.changed,
          appliedOpCount: result.appliedOpCount,
          errors: result.errors,
          validationIssueCount: result.validationIssueCount,
        },
        project: {
          name: state.project.name,
          scenes: state.project.scenes.map((scene) => ({
            id: scene.id,
            name: scene.name,
            objects: scene.objects.map((object) => ({
              id: object.id,
              name: object.name,
              x: object.x,
              visible: object.visible,
              parentId: object.parentId,
              physics: object.physics,
              collider: object.collider,
              costumes: object.costumes.map((costume) => ({ id: costume.id, name: costume.name })),
              currentCostumeIndex: object.currentCostumeIndex,
            })),
            objectFolders: scene.objectFolders.map((folder) => ({ id: folder.id, name: folder.name })),
          })),
        },
      };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, { projectOps: projectOps, fetchStatusCode: fetchStatus });
}

test.describe('LLM project ops apply', () => {
  test('applies end-to-end project ops mutation flow', async ({ page }) => {
    const projectOps = [
      { op: 'rename_project', name: 'Arcade Remix' },
      { op: 'create_scene', name: 'Bonus Stage' },
      { op: 'rename_scene', sceneId: 'scene-2', name: 'Arena' },
      { op: 'reorder_scenes', sceneIds: ['Arena', 'scene-1'] },
      { op: 'create_object', sceneId: 'scene-1', name: 'Coin', x: 120, y: 240 },
      { op: 'rename_object', sceneId: 'scene-1', objectId: 'Coin', name: 'Coin Pickup' },
      { op: 'set_object_property', sceneId: 'scene-1', objectId: 'Player', property: 'x', value: '42.5' },
      { op: 'set_object_property', sceneId: 'scene-1', objectId: 'Player', property: 'visible', value: 'false' },
      {
        op: 'set_object_physics',
        sceneId: 'scene-1',
        objectId: 'Player',
        physics: {
          enabled: true,
          bodyType: 'dynamic',
          gravityY: 2,
          velocityX: 5,
          velocityY: -2,
          bounce: 0.3,
          friction: 0.2,
          allowRotation: true,
        },
      },
      { op: 'set_object_collider_type', sceneId: 'scene-1', objectId: 'Player', colliderType: 'circle' },
      { op: 'create_folder', sceneId: 'scene-1', name: 'Collectibles', parentId: null },
      { op: 'move_object_to_folder', sceneId: 'scene-1', objectId: 'Coin Pickup', folderId: 'Collectibles' },
      { op: 'rename_folder', sceneId: 'scene-1', folderId: 'Collectibles', name: 'Loot' },
      {
        op: 'add_costume_text_circle',
        sceneId: 'scene-1',
        objectId: 'Player',
        name: 'Label',
        text: 'GO',
        fillColor: '#22c55e',
        textColor: '#111827',
      },
      { op: 'rename_costume', sceneId: 'scene-1', objectId: 'Player', costumeId: 'Label', name: 'Badge' },
      { op: 'reorder_costumes', sceneId: 'scene-1', objectId: 'Player', costumeIds: ['Badge', 'idle'] },
      { op: 'set_current_costume', sceneId: 'scene-1', objectId: 'Player', costumeId: 'Badge' },
      { op: 'validate_project' },
    ];

    const { result, project } = await runProjectOpsInBrowser(page, projectOps);

    expect(result.errors).toEqual([]);
    expect(result.appliedOpCount).toBe(projectOps.length);
    expect(result.changed).toBe(true);
    expect(project.name).toBe('Arcade Remix');
    expect(project.scenes.map((scene) => scene.name)).toEqual(['Arena', 'Scene 1', 'Bonus Stage']);

    const scene1 = project.scenes.find((scene) => scene.id === 'scene-1');
    expect(scene1).toBeDefined();

    const player = scene1!.objects.find((object) => object.name === 'Player');
    expect(player).toBeDefined();
    expect(player!.x).toBe(42.5);
    expect(player!.visible).toBe(false);
    expect(player!.physics?.enabled).toBe(true);
    expect(player!.physics?.gravityY).toBe(2);
    expect(player!.collider?.type).toBe('circle');

    const lootFolder = scene1!.objectFolders.find((folder) => folder.name === 'Loot');
    expect(lootFolder).toBeDefined();

    const movedCoin = scene1!.objects.find((object) => object.name === 'Coin Pickup');
    expect(movedCoin).toBeDefined();
    expect(movedCoin!.parentId).toBe(lootFolder!.id);

    const badgeIndex = player!.costumes.findIndex((costume) => costume.name === 'Badge');
    expect(badgeIndex).toBeGreaterThanOrEqual(0);
    expect(player!.currentCostumeIndex).toBe(badgeIndex);
    expect(result.validationIssueCount).toBeGreaterThanOrEqual(0);
  });

  test('reports coercion and reference errors for invalid property updates', async ({ page }) => {
    const projectOps = [
      { op: 'set_object_property', sceneId: 'scene-1', objectId: 'Player', property: 'x', value: 'abc' },
      { op: 'set_object_property', sceneId: 'scene-1', objectId: 'Player', property: 'visible', value: 'maybe' },
      { op: 'move_object_to_folder', sceneId: 'scene-1', objectId: 'Player', folderId: 'missing-folder' },
    ];

    const { result } = await runProjectOpsInBrowser(page, projectOps);

    expect(result.appliedOpCount).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.errors.join('\n')).toContain('requires numeric value');
    expect(result.errors.join('\n')).toContain('requires boolean value');
    expect(result.errors.join('\n')).toContain('Folder "missing-folder" was not found.');
  });

  test('surfaces image import fetch failures without crashing the apply pipeline', async ({ page }) => {
    const { result } = await runProjectOpsInBrowser(
      page,
      [
        {
          op: 'add_costume_from_image_url',
          sceneId: 'scene-1',
          objectId: 'Player',
          name: 'Fetched',
          imageUrl: 'https://example.com/missing.png',
        },
      ],
      404,
    );

    expect(result.appliedOpCount).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.errors.join('\n')).toContain('Image fetch failed (404).');
  });
});
