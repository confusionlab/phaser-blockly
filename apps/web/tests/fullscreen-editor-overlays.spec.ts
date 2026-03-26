import { expect, test, type Locator, type Page } from '@playwright/test';

async function bootstrapEditorProject(
  page: Page,
  options: { projectName: string; addObject?: boolean; blocklyXml?: string },
): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(async ({ projectName, addObject, blocklyXml }) => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    useProjectStore.getState().newProject(projectName);
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    if (!project) {
      throw new Error('Failed to create project');
    }

    const firstSceneId = project.scenes[0]?.id ?? null;
    useEditorStore.getState().selectScene(firstSceneId, { recordHistory: false });

    if (addObject && firstSceneId) {
      const createdObject = projectState.addObject(firstSceneId, 'Object 1');
      if (blocklyXml) {
        projectState.updateObject(firstSceneId, createdObject.id, { blocklyXml });
      }
      useEditorStore.getState().selectObject(createdObject.id, { recordHistory: false });
    }

    window.history.pushState({}, '', `/project/${project.id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, options);

  await page.waitForLoadState('networkidle');
}

async function selectObjectInSceneHierarchy(page: Page, objectName = 'Object 1'): Promise<void> {
  const objectLabel = page.getByText(new RegExp(`^${objectName}$`)).last();
  await expect(objectLabel).toBeVisible();
  await objectLabel.click();
  await expect(page.getByRole('radio', { name: /^code$/i })).toBeVisible();
}

async function enterFullscreenObjectEditor(page: Page): Promise<void> {
  const codePanel = page.locator('[data-editor-panel="code"]');
  await expect(codePanel).toBeVisible();

  const panelBox = await codePanel.boundingBox();
  expect(panelBox).not.toBeNull();
  if (!panelBox) {
    throw new Error('Code panel bounding box was not available.');
  }

  await page.mouse.click(
    panelBox.x + panelBox.width / 2,
    panelBox.y + Math.min(panelBox.height - 24, 180),
  );
  await page.keyboard.press('Backquote');

  const fullscreenToggle = page.getByTestId('object-editor-fullscreen-toggle');
  await expect(fullscreenToggle).toBeVisible();
  await expect(fullscreenToggle).toHaveAttribute('aria-label', 'Exit fullscreen editor');
  await expect(page.getByText('Code Editor (Press ` or Esc to exit)')).toHaveCount(0);
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

async function captureStageTransitionFrame(
  page: Page,
  buttonLabel: 'Fullscreen stage' | 'Exit fullscreen',
): Promise<{
  hostCenterX: number;
  hostCenterY: number;
  frozenCenterX: number;
  frozenCenterY: number;
}> {
  return page.evaluate((label) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (node) => node.getAttribute('aria-label') === label,
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Stage transition button not found: ${label}`);
    }

    button.click();

    const host = document.querySelector('[data-testid="stage-phaser-host"]');
    const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
    if (!(host instanceof HTMLElement)) {
      throw new Error('Stage host is missing during fullscreen transition.');
    }
    if (!(frozen instanceof HTMLImageElement)) {
      throw new Error('Frozen stage frame is missing during fullscreen transition.');
    }

    const hostRect = host.getBoundingClientRect();
    const frozenRect = frozen.getBoundingClientRect();
    return {
      hostCenterX: hostRect.left + hostRect.width / 2,
      hostCenterY: hostRect.top + hostRect.height / 2,
      frozenCenterX: frozenRect.left + frozenRect.width / 2,
      frozenCenterY: frozenRect.top + frozenRect.height / 2,
    };
  }, buttonLabel);
}

test.describe('Fullscreen editor overlays', () => {
  test('Object editor toolbar button enters fullscreen without the legacy shell header', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Object Editor Fullscreen ${Date.now()}`,
      addObject: true,
    });

    const fullscreenToggle = page.getByTestId('object-editor-fullscreen-toggle');
    await expect(fullscreenToggle).toBeVisible();
    await expect(fullscreenToggle).toHaveAttribute('aria-label', 'Fullscreen editor');

    await fullscreenToggle.click();

    await expect(fullscreenToggle).toHaveAttribute('aria-label', 'Exit fullscreen editor');
    await expect(page.getByText('Code Editor (Press ` or Esc to exit)')).toHaveCount(0);
  });

  test('Object editor fullscreen keeps the Blockly workspace mounted', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Object Editor Stable ${Date.now()}`,
      addObject: true,
    });

    const blocklySvg = page.locator('.blocklySvg').first();
    const fullscreenToggle = page.getByTestId('object-editor-fullscreen-toggle');
    await expect(blocklySvg).toBeVisible();
    await expect(fullscreenToggle).toBeVisible();

    await page.evaluate(() => {
      window['__pochaObjectEditorToggle'] = document.querySelector('[data-testid="object-editor-fullscreen-toggle"]');
      window['__pochaBlocklySvg'] = document.querySelector('.blocklySvg');
    });

    await fullscreenToggle.click();
    await expect(fullscreenToggle).toHaveAttribute('aria-label', 'Exit fullscreen editor');

    const fullscreenIdentity = await page.evaluate(() => ({
      sameToggle:
        document.querySelector('[data-testid="object-editor-fullscreen-toggle"]') === window['__pochaObjectEditorToggle'],
      sameBlocklySvg: document.querySelector('.blocklySvg') === window['__pochaBlocklySvg'],
    }));
    expect(fullscreenIdentity.sameToggle).toBe(true);
    expect(fullscreenIdentity.sameBlocklySvg).toBe(true);

    await page.keyboard.press('Backquote');
    await expect(fullscreenToggle).toHaveAttribute('aria-label', 'Fullscreen editor');

    const restoredIdentity = await page.evaluate(() => ({
      sameToggle:
        document.querySelector('[data-testid="object-editor-fullscreen-toggle"]') === window['__pochaObjectEditorToggle'],
      sameBlocklySvg: document.querySelector('.blocklySvg') === window['__pochaBlocklySvg'],
    }));
    expect(restoredIdentity.sameToggle).toBe(true);
    expect(restoredIdentity.sameBlocklySvg).toBe(true);
  });

  test('Stage fullscreen keeps the Phaser canvas mounted', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Stable ${Date.now()}`,
    });

    const stageHost = page.getByTestId('stage-phaser-host');
    const stageCanvas = stageHost.locator('canvas').first();
    await expect(stageHost).toBeVisible();
    await expect(stageCanvas).toBeVisible();

    await page.evaluate(() => {
      window['__pochaStageHost'] = document.querySelector('[data-testid="stage-phaser-host"]');
      window['__pochaStageCanvas'] = document.querySelector('[data-testid="stage-phaser-host"] canvas');
    });

    await page.getByRole('button', { name: 'Fullscreen stage' }).click();
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();

    const fullscreenIdentity = await page.evaluate(() => ({
      sameHost: document.querySelector('[data-testid="stage-phaser-host"]') === window['__pochaStageHost'],
      sameCanvas: document.querySelector('[data-testid="stage-phaser-host"] canvas') === window['__pochaStageCanvas'],
    }));
    expect(fullscreenIdentity.sameHost).toBe(true);
    expect(fullscreenIdentity.sameCanvas).toBe(true);

    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen stage' })).toBeVisible();

    const restoredIdentity = await page.evaluate(() => ({
      sameHost: document.querySelector('[data-testid="stage-phaser-host"]') === window['__pochaStageHost'],
      sameCanvas: document.querySelector('[data-testid="stage-phaser-host"] canvas') === window['__pochaStageCanvas'],
    }));
    expect(restoredIdentity.sameHost).toBe(true);
    expect(restoredIdentity.sameCanvas).toBe(true);
  });

  test.describe('Stage fullscreen transition anchoring', () => {
    test.use({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 2,
    });

    test('Frozen stage frame stays centered when entering and exiting fullscreen', async ({ page }) => {
      await bootstrapEditorProject(page, {
        projectName: `Stage Center Anchor ${Date.now()}`,
      });

      const enterTransition = await captureStageTransitionFrame(page, 'Fullscreen stage');
      expect(enterTransition.frozenCenterX).toBeCloseTo(enterTransition.hostCenterX, 0);
      expect(enterTransition.frozenCenterY).toBeCloseTo(enterTransition.hostCenterY, 0);

      await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();

      const exitTransition = await captureStageTransitionFrame(page, 'Exit fullscreen');
      expect(exitTransition.frozenCenterX).toBeCloseTo(exitTransition.hostCenterX, 0);
      expect(exitTransition.frozenCenterY).toBeCloseTo(exitTransition.hostCenterY, 0);

      await expect(page.getByRole('button', { name: 'Fullscreen stage' })).toBeVisible();
    });
  });

  test('Play mode overlay pill follows light mode', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Play Overlay Theme ${Date.now()}`,
    });

    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      useEditorStore.getState().setDarkMode(false);
      useEditorStore.getState().startPlaying();
    });

    const overlayPill = page.locator('[data-slot="overlay-pill"]').first();
    await expect(overlayPill).toBeVisible();

    const overlayClasses = await overlayPill.evaluate((element) => element.className);
    expect(overlayClasses).toContain('bg-white/36');
    expect(overlayClasses).not.toContain('bg-black/58');
  });

  test('Blockly dropdowns stay above the fullscreen code editor shell', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Fullscreen Blockly ${Date.now()}`,
      addObject: true,
      blocklyXml: `
        <xml xmlns="https://developers.google.com/blockly/xml">
          <block type="math_number_property" x="320" y="72">
            <field name="PROPERTY">EVEN</field>
            <value name="NUMBER_TO_CHECK">
              <shadow type="math_number">
                <field name="NUM">0</field>
              </shadow>
            </value>
          </block>
        </xml>
      `,
    });

    await selectObjectInSceneHierarchy(page);
    await page.getByRole('radio', { name: /^code$/i }).click();
    await enterFullscreenObjectEditor(page);

    const dropdownField = page.locator('.blocklyText').filter({ hasText: /^even$/i }).first();
    await expect(dropdownField).toBeVisible();
    await dropdownField.click();

    const dropdown = page.locator('.blocklyDropDownDiv');
    await expect(dropdown).toBeVisible();
    await expectLocatorToBeTopmost(dropdown);

    const dropdownZIndex = await dropdown.evaluate(
      (element) => Number.parseInt(getComputedStyle(element).zIndex || '0', 10),
    );
    expect(dropdownZIndex).toBeGreaterThan(100001);
  });

  test('Costume fullscreen keeps dropdown menus above the editor shell', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Fullscreen Costume ${Date.now()}`,
      addObject: true,
    });

    await selectObjectInSceneHierarchy(page);
    await page.getByRole('radio', { name: /^costume$/i }).click();
    await expect(page.getByTestId('costume-toolbar-tools')).toBeVisible();

    await enterFullscreenObjectEditor(page);

    await page.getByLabel('Open shape tools').click();

    const dropdown = page.locator('[data-slot="dropdown-menu-content"]').last();
    await expect(dropdown).toBeVisible();
    await expectLocatorToBeTopmost(dropdown);

    const dropdownZIndex = await dropdown.evaluate(
      (element) => Number.parseInt(getComputedStyle(element).zIndex || '0', 10),
    );
    expect(dropdownZIndex).toBeGreaterThan(100001);
  });

  test('Sound fullscreen keeps library dialogs above the editor shell', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Fullscreen Sound ${Date.now()}`,
      addObject: true,
    });

    await selectObjectInSceneHierarchy(page);
    await page.getByRole('radio', { name: /^sound$/i }).click();
    await expect(page.getByTitle('Record sound')).toBeVisible();
    await enterFullscreenObjectEditor(page);

    await page.getByTitle('Browse library').click();

    const dialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: 'Sound Library' });
    await expect(dialog).toBeVisible();
    await expectLocatorToBeTopmost(dialog);

    const dialogZIndex = await dialog.evaluate(
      (element) => Number.parseInt(getComputedStyle(element).zIndex || '0', 10),
    );
    expect(dialogZIndex).toBeGreaterThan(100001);
  });
});
