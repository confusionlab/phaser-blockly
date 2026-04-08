import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export interface ToolbarSliderChangeMeta {
  source: 'slider' | 'picker' | 'field';
  phase: 'preview' | 'commit';
}

export interface ToolbarSliderCommitBoundaryState {
  commitRevision: number;
  isPreviewActive: boolean;
}

export interface ResolveStyleSliderCommitActionOptions {
  commitRequested: boolean;
  didChange: boolean;
  hasPendingPreviewCommit: boolean;
  isPreviewActive: boolean;
}

export interface ResolveStyleSliderCommitActionResult {
  action: 'none' | 'schedule' | 'commit-now';
  hasPendingPreviewCommit: boolean;
}

export interface ResolveToolbarSliderPreviewScheduledCommitOptions {
  hasPendingPreviewCommit: boolean;
  hasScheduledCommit: boolean;
  isPreviewActive: boolean;
}

export interface ResolveToolbarSliderPreviewScheduledCommitResult {
  hasPendingPreviewCommit: boolean;
  shouldCancelScheduledCommit: boolean;
}

export const INITIAL_TOOLBAR_SLIDER_COMMIT_BOUNDARY_STATE: ToolbarSliderCommitBoundaryState = {
  commitRevision: 0,
  isPreviewActive: false,
};

export function reduceToolbarSliderCommitBoundaryState(
  current: ToolbarSliderCommitBoundaryState,
  meta?: ToolbarSliderChangeMeta,
): ToolbarSliderCommitBoundaryState {
  if (!meta || (meta.source !== 'slider' && meta.source !== 'picker' && meta.source !== 'field')) {
    return current;
  }

  if (meta.phase === 'preview') {
    return current.isPreviewActive
      ? current
      : {
          ...current,
          isPreviewActive: true,
        };
  }

  return {
    commitRevision: current.commitRevision + 1,
    isPreviewActive: false,
  };
}

export function resolveStyleSliderCommitAction({
  commitRequested,
  didChange,
  hasPendingPreviewCommit,
  isPreviewActive,
}: ResolveStyleSliderCommitActionOptions): ResolveStyleSliderCommitActionResult {
  if (isPreviewActive) {
    return {
      action: 'none',
      hasPendingPreviewCommit: hasPendingPreviewCommit || didChange,
    };
  }

  if (commitRequested && hasPendingPreviewCommit) {
    return {
      action: 'commit-now',
      hasPendingPreviewCommit: false,
    };
  }

  if (!didChange) {
    return {
      action: 'none',
      hasPendingPreviewCommit,
    };
  }

  return {
    action: commitRequested ? 'commit-now' : 'schedule',
    hasPendingPreviewCommit: false,
  };
}

export function resolveToolbarSliderPreviewScheduledCommit({
  hasPendingPreviewCommit,
  hasScheduledCommit,
  isPreviewActive,
}: ResolveToolbarSliderPreviewScheduledCommitOptions): ResolveToolbarSliderPreviewScheduledCommitResult {
  if (!isPreviewActive || !hasScheduledCommit) {
    return {
      hasPendingPreviewCommit,
      shouldCancelScheduledCommit: false,
    };
  }

  return {
    hasPendingPreviewCommit: true,
    shouldCancelScheduledCommit: true,
  };
}

export function useToolbarSliderPreviewCommitDeferral(
  isPreviewActive: boolean,
  pendingScheduledCommitRef: MutableRefObject<number | null>,
  pendingPreviewCommitRef: MutableRefObject<boolean>,
) {
  useEffect(() => {
    const resolution = resolveToolbarSliderPreviewScheduledCommit({
      hasPendingPreviewCommit: pendingPreviewCommitRef.current,
      hasScheduledCommit: pendingScheduledCommitRef.current !== null,
      isPreviewActive,
    });

    pendingPreviewCommitRef.current = resolution.hasPendingPreviewCommit;
    if (!resolution.shouldCancelScheduledCommit || typeof window === 'undefined') {
      return;
    }

    window.clearTimeout(pendingScheduledCommitRef.current!);
    pendingScheduledCommitRef.current = null;
  }, [isPreviewActive, pendingPreviewCommitRef, pendingScheduledCommitRef]);
}

export function useToolbarSliderCommitBoundary() {
  const [state, setState] = useState(INITIAL_TOOLBAR_SLIDER_COMMIT_BOUNDARY_STATE);
  const stateRef = useRef(INITIAL_TOOLBAR_SLIDER_COMMIT_BOUNDARY_STATE);

  const registerSliderChangeMeta = useCallback((meta?: ToolbarSliderChangeMeta) => {
    if (!meta) {
      return;
    }

    const next = reduceToolbarSliderCommitBoundaryState(stateRef.current, meta);
    stateRef.current = next;
    setState(next);
  }, []);

  return {
    registerSliderChangeMeta,
    sliderCommitBoundaryState: state,
    sliderCommitBoundaryStateRef: stateRef,
  };
}
