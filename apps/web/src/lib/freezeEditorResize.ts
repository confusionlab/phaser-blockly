const EDITOR_RESIZE_FREEZE_EVENT = 'pocha-editor-resize-freeze';

let pendingFreezeCount = 0;

function dispatchEditorResizeFreeze(active: boolean): void {
  window.dispatchEvent(new CustomEvent(EDITOR_RESIZE_FREEZE_EVENT, { detail: { active } }));
}

function releaseEditorResizeFreeze(): void {
  pendingFreezeCount = Math.max(0, pendingFreezeCount - 1);
  if (pendingFreezeCount === 0) {
    dispatchEditorResizeFreeze(false);
  }
}

export function freezeEditorResizeForLayoutTransition(): void {
  if (typeof window === 'undefined') {
    return;
  }

  pendingFreezeCount += 1;
  if (pendingFreezeCount === 1) {
    dispatchEditorResizeFreeze(true);
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      releaseEditorResizeFreeze();
    });
  });
}
