import { expect, test } from '@playwright/test';

import {
  deriveEditorSaveControlState,
  doesLocalProjectMatchCloudHead,
  shouldTreatOpenedProjectAsCloudSaved,
} from '../src/lib/cloudProjectState';

test.describe('cloud project state', () => {
  test('treats matching schema and content as already current', () => {
    expect(
      doesLocalProjectMatchCloudHead({
        localSchemaVersion: 10,
        localContentHash: 'aaaaaaaaaaaaaaaa',
        cloudSchemaVersion: 10,
        cloudContentHash: 'aaaaaaaaaaaaaaaa',
        migrated: false,
      }),
    ).toBe(true);
  });

  test('keeps divergent local content marked as needing a push', () => {
    expect(
      doesLocalProjectMatchCloudHead({
        localSchemaVersion: 10,
        localContentHash: 'bbbbbbbbbbbbbbbb',
        cloudSchemaVersion: 10,
        cloudContentHash: 'aaaaaaaaaaaaaaaa',
        migrated: false,
      }),
    ).toBe(false);
  });

  test('treats migrated cloud data as needing a save back to cloud', () => {
    expect(
      doesLocalProjectMatchCloudHead({
        localSchemaVersion: 10,
        localContentHash: 'aaaaaaaaaaaaaaaa',
        cloudSchemaVersion: 9,
        cloudContentHash: 'aaaaaaaaaaaaaaaa',
        migrated: true,
      }),
    ).toBe(false);
  });

  test('keeps an opened cloud cache marked as saved when cloud verification errors', () => {
    expect(
      shouldTreatOpenedProjectAsCloudSaved({
        openedFromCloudCache: true,
        matchesCloudHead: false,
        pullStatus: 'error',
      }),
    ).toBe(true);
  });

  test('does not treat a newer local draft as already saved just because it came from cache', () => {
    expect(
      shouldTreatOpenedProjectAsCloudSaved({
        openedFromCloudCache: true,
        matchesCloudHead: false,
        pullStatus: 'unchanged',
      }),
    ).toBe(false);
  });

  test('shows a freshly opened clean project as saved while cloud catch-up is pending', () => {
    expect(
      deriveEditorSaveControlState({
        hasProject: true,
        isDirty: false,
        hasActionableCloudError: false,
        isManualSaveInProgress: false,
      }),
    ).toBe('saved');
  });

  test('keeps dirty projects actionable until cloud sync completes', () => {
    expect(
      deriveEditorSaveControlState({
        hasProject: true,
        isDirty: true,
        hasActionableCloudError: false,
        isManualSaveInProgress: false,
      }),
    ).toBe('save');
  });

  test('only shows saving for explicit manual saves and save for actionable errors', () => {
    expect(
      deriveEditorSaveControlState({
        hasProject: true,
        isDirty: false,
        hasActionableCloudError: false,
        isManualSaveInProgress: true,
      }),
    ).toBe('saving');

    expect(
      deriveEditorSaveControlState({
        hasProject: true,
        isDirty: false,
        hasActionableCloudError: true,
        isManualSaveInProgress: false,
      }),
    ).toBe('save');
  });
});
