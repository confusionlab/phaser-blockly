import { expect, test } from '@playwright/test';
import {
  INITIAL_TOOLBAR_SLIDER_COMMIT_BOUNDARY_STATE,
  reduceToolbarSliderCommitBoundaryState,
  resolveToolbarSliderPreviewScheduledCommit,
  resolveStyleSliderCommitAction,
} from '../src/components/editors/shared/toolbarSliderCommitBoundary';

test.describe('toolbar slider commit boundary', () => {
  test('keeps preview interactions local until commit', () => {
    const previewState = reduceToolbarSliderCommitBoundaryState(
      INITIAL_TOOLBAR_SLIDER_COMMIT_BOUNDARY_STATE,
      {
        source: 'slider',
        phase: 'preview',
      },
    );

    expect(previewState).toEqual({
      commitRevision: 0,
      isPreviewActive: true,
    });

    expect(resolveStyleSliderCommitAction({
      commitRequested: false,
      didChange: true,
      hasPendingPreviewCommit: false,
      isPreviewActive: previewState.isPreviewActive,
    })).toEqual({
      action: 'none',
      hasPendingPreviewCommit: true,
    });
  });

  test('flushes the pending preview when the slider commits', () => {
    const commitState = reduceToolbarSliderCommitBoundaryState({
      commitRevision: 0,
      isPreviewActive: true,
    }, {
      source: 'slider',
      phase: 'commit',
    });

    expect(commitState).toEqual({
      commitRevision: 1,
      isPreviewActive: false,
    });

    expect(resolveStyleSliderCommitAction({
      commitRequested: true,
      didChange: false,
      hasPendingPreviewCommit: true,
      isPreviewActive: commitState.isPreviewActive,
    })).toEqual({
      action: 'commit-now',
      hasPendingPreviewCommit: false,
    });
  });

  test('keeps non-slider style changes on the existing scheduled commit path', () => {
    expect(resolveStyleSliderCommitAction({
      commitRequested: false,
      didChange: true,
      hasPendingPreviewCommit: false,
      isPreviewActive: false,
    })).toEqual({
      action: 'schedule',
      hasPendingPreviewCommit: false,
    });
  });

  test('defers scheduled commits once slider preview becomes active', () => {
    expect(resolveToolbarSliderPreviewScheduledCommit({
      hasPendingPreviewCommit: false,
      hasScheduledCommit: true,
      isPreviewActive: true,
    })).toEqual({
      hasPendingPreviewCommit: true,
      shouldCancelScheduledCommit: true,
    });

    expect(resolveToolbarSliderPreviewScheduledCommit({
      hasPendingPreviewCommit: false,
      hasScheduledCommit: true,
      isPreviewActive: false,
    })).toEqual({
      hasPendingPreviewCommit: false,
      shouldCancelScheduledCommit: false,
    });
  });
});
