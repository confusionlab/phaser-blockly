import * as Blockly from 'blockly';
import {
  ContinuousFlyout,
  ContinuousMetrics,
  ContinuousToolbox,
  registerContinuousToolbox,
} from '@blockly/continuous-toolbox';

const PINNABLE_METRICS_REGISTRATION = 'PochaContinuousMetrics';
const PINNABLE_TOOLBOX_REGISTRATION = 'PochaContinuousToolbox';

let registered = false;
let initialPinnedState = true;

function isFlyoutVisible(workspace: Blockly.WorkspaceSvg): boolean {
  const flyout = workspace.getFlyout();
  return Boolean(flyout?.isVisible());
}

export class PinnableContinuousMetrics extends ContinuousMetrics {
  override getViewMetrics(
    getWorkspaceCoordinates = false,
  ): Blockly.MetricsManager.ContainerRegion {
    const scale = getWorkspaceCoordinates ? this.workspace_.scale : 1;
    const svgMetrics = this.getSvgMetrics();
    const toolboxMetrics = this.getToolboxMetrics();
    const flyoutMetrics = isFlyoutVisible(this.workspace_)
      ? this.getFlyoutMetrics(false)
      : { width: 0, height: 0 };
    const toolboxPosition = toolboxMetrics.position;

    if (this.workspace_.getToolbox()) {
      if (
        toolboxPosition == Blockly.TOOLBOX_AT_TOP ||
        toolboxPosition == Blockly.TOOLBOX_AT_BOTTOM
      ) {
        svgMetrics.height -= toolboxMetrics.height + flyoutMetrics.height;
      } else if (
        toolboxPosition == Blockly.TOOLBOX_AT_LEFT ||
        toolboxPosition == Blockly.TOOLBOX_AT_RIGHT
      ) {
        svgMetrics.width -= toolboxMetrics.width + flyoutMetrics.width;
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
    const flyoutMetrics = isFlyoutVisible(this.workspace_)
      ? this.getFlyoutMetrics(false)
      : { width: 0, height: 0 };
    const toolboxPosition = toolboxMetrics.position;

    let absoluteLeft = 0;
    if (
      this.workspace_.getToolbox() &&
      toolboxPosition == Blockly.TOOLBOX_AT_LEFT
    ) {
      absoluteLeft = toolboxMetrics.width + flyoutMetrics.width;
    }

    let absoluteTop = 0;
    if (
      this.workspace_.getToolbox() &&
      toolboxPosition == Blockly.TOOLBOX_AT_TOP
    ) {
      absoluteTop = toolboxMetrics.height + flyoutMetrics.height;
    }

    return {
      top: absoluteTop,
      left: absoluteLeft,
    };
  }
}

export class PinnableContinuousToolbox extends ContinuousToolbox {
  private pinned = initialPinnedState;

  override init() {
    super.init();
    this.applyPinnedState(this.pinned, true);
  }

  override getFlyout(): ContinuousFlyout {
    return super.getFlyout() as ContinuousFlyout;
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

  isPinned(): boolean {
    return this.pinned;
  }

  setPinned(pinned: boolean): void {
    if (this.pinned === pinned) return;
    this.pinned = pinned;
    this.applyPinnedState(pinned, false);
  }

  private applyPinnedState(pinned: boolean, initializing: boolean): void {
    const flyout = this.getFlyout();
    flyout.setAutoClose(!pinned);

    if (pinned) {
      flyout.show(this.getInitialFlyoutContents_());
    } else {
      flyout.hide();
      this.clearSelection();
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

export const PINNABLE_CONTINUOUS_METRICS = PINNABLE_METRICS_REGISTRATION;
export const PINNABLE_CONTINUOUS_TOOLBOX = PINNABLE_TOOLBOX_REGISTRATION;
