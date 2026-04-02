import * as Blockly from 'blockly';
import {
  ContinuousFlyout,
  ContinuousMetrics,
  ContinuousToolbox,
  registerContinuousToolbox,
} from '@blockly/continuous-toolbox';
import { PochaToolboxCategory } from './PochaToolboxCategory';

const FLYOUT_WIDTH_CSS_VAR = '--blockly-flyout-width';
const PINNABLE_FLYOUT_REGISTRATION = 'PochaContinuousFlyout';
const PINNABLE_METRICS_REGISTRATION = 'PochaContinuousMetrics';
const PINNABLE_TOOLBOX_REGISTRATION = 'PochaContinuousToolbox';

export const PINNED_TOOLBOX_FLYOUT_WIDTH = 250;
export const UNPINNED_TOOLBOX_FLYOUT_WIDTH = 350;

let registered = false;
let initialPinnedState = true;

function getConfiguredFlyoutWidth(
  workspace: Blockly.WorkspaceSvg | null,
): number {
  if (typeof window === 'undefined' || !workspace) {
    return PINNED_TOOLBOX_FLYOUT_WIDTH;
  }

  const rawValue = window
    .getComputedStyle(workspace.getInjectionDiv())
    .getPropertyValue(FLYOUT_WIDTH_CSS_VAR)
    .trim();
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue)
    ? parsedValue
    : PINNED_TOOLBOX_FLYOUT_WIDTH;
}

export class PinnableContinuousFlyout extends ContinuousFlyout {
  protected override reflowInternal_(): void {
    super.reflowInternal_();

    const targetWorkspace = this.targetWorkspace;
    if (!targetWorkspace) {
      return;
    }

    const configuredWidth = getConfiguredFlyoutWidth(targetWorkspace);
    if (this.getWidth() === configuredWidth) {
      return;
    }

    if (this.RTL) {
      for (const item of this.getContents()) {
        const oldX = item.getElement().getBoundingRectangle().left;
        const newX =
          configuredWidth / this.workspace_.scale -
          item.getElement().getBoundingRectangle().getWidth() -
          this.MARGIN -
          this.tabWidth_;
        item.getElement().moveBy(newX - oldX, 0);
      }
    }

    if (
      !targetWorkspace.scrollbar &&
      !this.autoClose &&
      targetWorkspace.getFlyout() === this &&
      this.toolboxPosition_ === Blockly.utils.toolbox.Position.LEFT
    ) {
      targetWorkspace.translate(
        targetWorkspace.scrollX + configuredWidth,
        targetWorkspace.scrollY,
      );
    }

    this.width_ = configuredWidth;
    this.position();
    targetWorkspace.resizeContents();
    targetWorkspace.recordDragTargets();
  }
}

export class PinnableContinuousMetrics extends ContinuousMetrics {
  override getViewMetrics(
    getWorkspaceCoordinates = false,
  ): Blockly.MetricsManager.ContainerRegion {
    const scale = getWorkspaceCoordinates ? this.workspace_.scale : 1;
    const svgMetrics = this.getSvgMetrics();
    const toolboxMetrics = this.getToolboxMetrics();
    const toolboxPosition = toolboxMetrics.position;

    if (this.workspace_.getToolbox()) {
      if (
        toolboxPosition == Blockly.TOOLBOX_AT_TOP ||
        toolboxPosition == Blockly.TOOLBOX_AT_BOTTOM
      ) {
        svgMetrics.height -= toolboxMetrics.height;
      } else if (
        toolboxPosition == Blockly.TOOLBOX_AT_LEFT ||
        toolboxPosition == Blockly.TOOLBOX_AT_RIGHT
      ) {
        svgMetrics.width -= toolboxMetrics.width;
      }
    }

    return {
      height: svgMetrics.height / scale,
      width: svgMetrics.width / scale,
      top: -this.workspace_.scrollY / scale,
      left: -this.workspace_.scrollX / scale,
    };
  }

  override getAbsoluteMetrics(): Blockly.MetricsManager.AbsoluteMetrics {
    const toolboxMetrics = this.getToolboxMetrics();
    const toolboxPosition = toolboxMetrics.position;

    let absoluteLeft = 0;
    if (
      this.workspace_.getToolbox() &&
      toolboxPosition == Blockly.TOOLBOX_AT_LEFT
    ) {
      absoluteLeft = toolboxMetrics.width;
    }

    let absoluteTop = 0;
    if (
      this.workspace_.getToolbox() &&
      toolboxPosition == Blockly.TOOLBOX_AT_TOP
    ) {
      absoluteTop = toolboxMetrics.height;
    }

    return {
      top: absoluteTop,
      left: absoluteLeft,
    };
  }
}

export class PinnableContinuousToolbox extends ContinuousToolbox {
  private pinned = initialPinnedState;
  private pinnableRefreshDebouncer?: ReturnType<typeof setTimeout>;

  override init() {
    super.init();
    this.applyPinnedState(this.pinned, true);
  }

  override getFlyout(): PinnableContinuousFlyout {
    return super.getFlyout() as PinnableContinuousFlyout;
  }

  override updateFlyout_(
    _oldItem: Blockly.ISelectableToolboxItem | null,
    newItem: Blockly.ISelectableToolboxItem | null,
  ) {
    const flyout = this.getFlyout();

    if (newItem) {
      if (!flyout.isVisible()) {
        flyout.show(this.getInitialFlyoutContents_());
      }
      flyout.scrollToCategory(newItem);
      return;
    }

    if (flyout.autoClose) {
      flyout.hide();
    }
  }

  override refreshSelection() {
    if (this.pinnableRefreshDebouncer) {
      clearTimeout(this.pinnableRefreshDebouncer);
      this.pinnableRefreshDebouncer = undefined;
    }

    if (!this.getFlyout().isVisible()) {
      return;
    }

    this.pinnableRefreshDebouncer = setTimeout(() => {
      if (!this.getFlyout().isVisible()) {
        return;
      }

      this.getFlyout().show(this.getInitialFlyoutContents_());
      this.pinnableRefreshDebouncer = undefined;
    }, 100);
  }

  isPinned(): boolean {
    return this.pinned;
  }

  setPinned(pinned: boolean): void {
    if (this.pinned === pinned) return;
    this.pinned = pinned;
    this.applyPinnedState(pinned, false);
  }

  collapseFlyout(): void {
    if (this.pinned) return;

    if (this.pinnableRefreshDebouncer) {
      clearTimeout(this.pinnableRefreshDebouncer);
      this.pinnableRefreshDebouncer = undefined;
    }

    this.getFlyout().hide();
    this.clearSelection();
    this.getWorkspace().resizeContents();
    Blockly.svgResize(this.getWorkspace());
  }

  private applyPinnedState(pinned: boolean, initializing: boolean): void {
    const flyout = this.getFlyout();
    // In pinned mode the always-open flyout should act as the delete area.
    // In unpinned mode, hand deletion back to the toolbox rail so dropping
    // onto the category column while the flyout is collapsed disposes blocks.
    flyout.setAutoClose(!pinned);

    if (pinned) {
      flyout.show(this.getInitialFlyoutContents_());
    } else {
      this.collapseFlyout();
    }

    if (!initializing) {
      this.getWorkspace().resizeContents();
      Blockly.svgResize(this.getWorkspace());
    }
  }

  private getInitialFlyoutContents_(): Blockly.utils.toolbox.FlyoutItemInfoArray {
    return this.getToolboxItems().flatMap((toolboxItem) =>
      this.convertToolboxItemToFlyoutItems(toolboxItem),
    );
  }
}

export function setInitialPinnableToolboxPinnedState(pinned: boolean): void {
  initialPinnedState = pinned;
}

export function registerPinnableContinuousToolbox(): void {
  if (registered) return;

  registerContinuousToolbox();

  Blockly.registry.register(
    Blockly.registry.Type.TOOLBOX_ITEM,
    Blockly.ToolboxCategory.registrationName,
    PochaToolboxCategory,
    true,
  );

  Blockly.registry.register(
    Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX,
    PINNABLE_FLYOUT_REGISTRATION,
    PinnableContinuousFlyout,
    true,
  );

  Blockly.registry.register(
    Blockly.registry.Type.METRICS_MANAGER,
    PINNABLE_METRICS_REGISTRATION,
    PinnableContinuousMetrics,
    true,
  );

  Blockly.registry.register(
    Blockly.registry.Type.TOOLBOX,
    PINNABLE_TOOLBOX_REGISTRATION,
    PinnableContinuousToolbox,
    true,
  );

  registered = true;
}

export function isPinnableContinuousToolbox(
  toolbox: Blockly.IToolbox | null,
): toolbox is PinnableContinuousToolbox {
  return toolbox instanceof PinnableContinuousToolbox;
}

export const PINNABLE_CONTINUOUS_FLYOUT = PINNABLE_FLYOUT_REGISTRATION;
export const PINNABLE_CONTINUOUS_METRICS = PINNABLE_METRICS_REGISTRATION;
export const PINNABLE_CONTINUOUS_TOOLBOX = PINNABLE_TOOLBOX_REGISTRATION;
