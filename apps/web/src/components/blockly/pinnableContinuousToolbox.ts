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
    flyout.setAutoClose(false);

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
