import { expect, test } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

type BlocklyScaleSnapshot = {
  workspaceScale: number;
  flyoutScale: number | null;
};

type FlyoutTransferSnapshot = {
  originalLeft: number;
  originalTop: number;
  newLeft: number;
  newTop: number;
  workspaceScale: number;
  flyoutScale: number;
};

async function readBlocklyScales(page: import('@playwright/test').Page): Promise<BlocklyScaleSnapshot> {
  return page.evaluate(() => {
    const workspace = (window as Window & {
      __pochaBlocklyWorkspace?: {
        scale: number;
        getFlyout: () => { getWorkspace: () => { scale: number } } | null;
      } | null;
    }).__pochaBlocklyWorkspace ?? null;
    if (!workspace) {
      throw new Error('Blockly workspace was not available.');
    }

    const flyout = workspace.getFlyout();
    return {
      workspaceScale: workspace.scale,
      flyoutScale: flyout?.getWorkspace().scale ?? null,
    };
  });
}

async function createBlockFromFlyoutAtWorkspaceScale(
  page: import('@playwright/test').Page,
  workspaceScale: number,
): Promise<FlyoutTransferSnapshot> {
  return page.evaluate((nextWorkspaceScale) => {
    const workspace = (window as Window & {
      __pochaBlocklyWorkspace?: {
        scale: number;
        setScale: (scale: number) => void;
        getFlyout: () => {
          getWorkspace: () => {
            scale: number;
            getTopBlocks: (ordered?: boolean) => Array<{
              getSvgRoot: () => SVGElement | null;
            }>;
          };
          createBlock: (block: unknown) => {
            getSvgRoot: () => SVGElement | null;
          };
        } | null;
      } | null;
    }).__pochaBlocklyWorkspace ?? null;
    if (!workspace) {
      throw new Error('Blockly workspace was not available.');
    }

    workspace.setScale(nextWorkspaceScale);
    const flyout = workspace.getFlyout();
    if (!flyout) {
      throw new Error('Blockly flyout was not available.');
    }

    const originalBlock = flyout.getWorkspace().getTopBlocks(false)[0];
    if (!originalBlock) {
      throw new Error('No flyout block was available.');
    }

    const originalRect = originalBlock.getSvgRoot()?.getBoundingClientRect();
    if (!originalRect) {
      throw new Error('Original flyout block rect was not available.');
    }

    const createdBlock = flyout.createBlock(originalBlock);
    const createdRect = createdBlock.getSvgRoot()?.getBoundingClientRect();
    if (!createdRect) {
      throw new Error('Created workspace block rect was not available.');
    }

    return {
      originalLeft: originalRect.left,
      originalTop: originalRect.top,
      newLeft: createdRect.left,
      newTop: createdRect.top,
      workspaceScale: workspace.scale,
      flyoutScale: flyout.getWorkspace().scale,
    };
  }, workspaceScale);
}

test.describe('Blockly toolbox zoom', () => {
  test('uses a narrower category rail without shrinking the category content', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Blockly Toolbox Rail ${Date.now()}`,
      addObject: true,
      blocklyXml: `
        <xml xmlns="https://developers.google.com/blockly/xml">
          <block type="controls_whenflagclicked" x="24" y="24"></block>
        </xml>
      `,
    });

    const rail = page.locator('.blocklyToolbox').first();
    const button = page.locator('.pochaBlocklyCategoryButton').first();
    const content = page.locator('.pochaBlocklyCategoryContent').first();
    await expect(rail).toBeVisible();
    await expect(button).toBeVisible();
    await expect(content).toBeVisible();

    const metrics = await page.evaluate(() => {
      const railElement = document.querySelector('.blocklyToolbox');
      const buttonElement = document.querySelector('.pochaBlocklyCategoryButton');
      const contentElement = document.querySelector('.pochaBlocklyCategoryContent');
      if (
        !(railElement instanceof HTMLElement) ||
        !(buttonElement instanceof HTMLElement) ||
        !(contentElement instanceof HTMLElement)
      ) {
        throw new Error('Expected Blockly category elements were not available.');
      }

      return {
        railWidth: railElement.getBoundingClientRect().width,
        buttonWidth: buttonElement.getBoundingClientRect().width,
        contentWidth: contentElement.getBoundingClientRect().width,
        contentHeight: contentElement.getBoundingClientRect().height,
      };
    });

    expect(metrics.railWidth).toBeLessThan(68);
    expect(metrics.buttonWidth).toBeLessThan(metrics.contentWidth);
    expect(metrics.contentWidth).toBeGreaterThanOrEqual(55);
    expect(metrics.contentHeight).toBeGreaterThanOrEqual(55);
  });

  test('keeps the toolbox flyout at fixed scale while editor zoom changes', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Blockly Toolbox Zoom ${Date.now()}`,
      addObject: true,
      blocklyXml: `
        <xml xmlns="https://developers.google.com/blockly/xml">
          <block type="controls_whenflagclicked" x="24" y="24"></block>
        </xml>
      `,
    });

    await expect(page.locator('[data-blockly-editor="true"] .blocklySvg')).toBeVisible();

    const initialScales = await readBlocklyScales(page);
    expect(initialScales.flyoutScale).toBe(0.7);

    await page.evaluate(() => {
      const workspace = (window as Window & {
        __pochaBlocklyWorkspace?: { zoomCenter: (amount: number) => void } | null;
      }).__pochaBlocklyWorkspace ?? null;
      if (!workspace) {
        throw new Error('Blockly workspace was not available.');
      }

      workspace.zoomCenter(1);
    });

    await expect.poll(async () => {
      const nextScales = await readBlocklyScales(page);
      return nextScales.workspaceScale;
    }).not.toBe(initialScales.workspaceScale);

    const zoomedScales = await readBlocklyScales(page);
    expect(zoomedScales.flyoutScale).toBe(0.7);
  });

  test('keeps flyout-to-workspace block transfer anchored when the workspace is zoomed out', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Blockly Flyout Drag ${Date.now()}`,
      addObject: true,
      blocklyXml: `
        <xml xmlns="https://developers.google.com/blockly/xml">
          <block type="controls_whenflagclicked" x="24" y="24"></block>
        </xml>
      `,
    });

    await expect(page.locator('[data-blockly-editor="true"] .blocklySvg')).toBeVisible();

    const transfer = await createBlockFromFlyoutAtWorkspaceScale(page, 0.5);
    expect(transfer.workspaceScale).toBe(0.5);
    expect(transfer.flyoutScale).toBe(0.7);
    expect(Math.abs(transfer.newLeft - transfer.originalLeft)).toBeLessThanOrEqual(2);
    expect(Math.abs(transfer.newTop - transfer.originalTop)).toBeLessThanOrEqual(2);
  });
});
