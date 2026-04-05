import { useCallback, useState } from 'react';

export interface ToolbarSliderChangeMeta {
  source: 'slider';
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

export const INITIAL_TOOLBAR_SLIDER_COMMIT_BOUNDARY_STATE: ToolbarSliderCommitBoundaryState = {
  commitRevision: 0,
  isPreviewActive: false,
};

export function reduceToolbarSliderCommitBoundaryState(
  current: ToolbarSliderCommitBoundaryState,
  meta?: ToolbarSliderChangeMeta,
): ToolbarSliderCommitBoundaryState {
  if (!meta || meta.source !== 'slider') {
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

export function useToolbarSliderCommitBoundary() {
  const [state, setState] = useState(INITIAL_TOOLBAR_SLIDER_COMMIT_BOUNDARY_STATE);

  const registerSliderChangeMeta = useCallback((meta?: ToolbarSliderChangeMeta) => {
    if (!meta) {
      return;
    }

    setState((current) => reduceToolbarSliderCommitBoundaryState(current, meta));
  }, []);

  return {
    registerSliderChangeMeta,
    sliderCommitBoundaryState: state,
  };
}
