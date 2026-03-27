import { expect, test } from '@playwright/test';
import { planProjectSyncAction, planRevisionSyncAction, selectUncoveredAssetIdsForSync } from '../../../convex/projects';

test.describe('cloud sync planning', () => {
  test('skips project upload when hashes already match', () => {
    const result = planProjectSyncAction(
      {
        updatedAt: 1_000,
        schemaVersion: 9,
        contentHash: 'aaaaaaaaaaaaaaaa',
      },
      {
        localId: 'project-1',
        updatedAt: 1_000,
        schemaVersion: 9,
        contentHash: 'aaaaaaaaaaaaaaaa',
      },
    );

    expect(result).toEqual({
      action: 'skip',
      reason: 'content already in sync',
    });
  });

  test('skips project upload when only the timestamp is newer but content matches', () => {
    const result = planProjectSyncAction(
      {
        updatedAt: 1_000,
        schemaVersion: 9,
        contentHash: 'aaaaaaaaaaaaaaaa',
      },
      {
        localId: 'project-1',
        updatedAt: 2_000,
        schemaVersion: 9,
        contentHash: 'aaaaaaaaaaaaaaaa',
      },
    );

    expect(result).toEqual({
      action: 'skip',
      reason: 'content already in sync',
    });
  });

  test('requests a pull when the cloud copy is newer', () => {
    const result = planProjectSyncAction(
      {
        updatedAt: 2_000,
        schemaVersion: 9,
        contentHash: 'bbbbbbbbbbbbbbbb',
      },
      {
        localId: 'project-1',
        updatedAt: 1_000,
        schemaVersion: 9,
        contentHash: 'aaaaaaaaaaaaaaaa',
      },
    );

    expect(result).toEqual({
      action: 'pull',
      reason: 'cloud project is newer',
    });
  });

  test('uploads a missing revision', () => {
    const result = planRevisionSyncAction(null, {
      revisionId: 'revision-1',
      createdAt: 1_000,
      updatedAt: 1_000,
      schemaVersion: 9,
      contentHash: 'aaaaaaaaaaaaaaaa',
      reason: 'auto_checkpoint',
      checkpointName: undefined,
      isCheckpoint: true,
    });

    expect(result).toEqual({
      action: 'upload',
      reason: 'cloud revision is missing',
    });
  });

  test('skips revision upload when metadata matches', () => {
    const result = planRevisionSyncAction(
      {
        createdAt: 1_000,
        contentHash: 'aaaaaaaaaaaaaaaa',
        checkpointName: 'Checkpoint',
        reason: 'manual_checkpoint',
        isCheckpoint: true,
      },
      {
        revisionId: 'revision-1',
        createdAt: 1_000,
        updatedAt: 1_000,
        schemaVersion: 9,
        contentHash: 'aaaaaaaaaaaaaaaa',
        reason: 'manual_checkpoint',
        checkpointName: 'Checkpoint',
        isCheckpoint: true,
      },
    );

    expect(result).toEqual({
      action: 'skip',
      reason: 'cloud revision is newer or equal',
    });
  });

  test('uploads revision metadata changes when updatedAt is newer but createdAt is unchanged', () => {
    const result = planRevisionSyncAction(
      {
        createdAt: 1_000,
        updatedAt: 1_000,
        contentHash: 'aaaaaaaaaaaaaaaa',
        checkpointName: 'Old Name',
        reason: 'manual_checkpoint',
        isCheckpoint: true,
      },
      {
        revisionId: 'revision-1',
        createdAt: 1_000,
        updatedAt: 2_000,
        schemaVersion: 9,
        contentHash: 'aaaaaaaaaaaaaaaa',
        reason: 'manual_checkpoint',
        checkpointName: 'New Name',
        isCheckpoint: true,
      },
    );

    expect(result).toEqual({
      action: 'upload',
      reason: 'local revision is newer',
    });
  });

  test('only schedules uncovered asset ids for upload', () => {
    const coveredAssetIds = new Set([
      `asset:${'a'.repeat(64)}`,
      `asset:${'b'.repeat(64)}`,
    ]);

    expect(
      selectUncoveredAssetIdsForSync(
        [
          `asset:${'a'.repeat(64)}`,
          `asset:${'c'.repeat(64)}`,
          `asset:${'c'.repeat(64)}`,
          'not-an-asset-id',
        ],
        coveredAssetIds,
      ),
    ).toEqual([
      `asset:${'c'.repeat(64)}`,
    ]);
  });
});
