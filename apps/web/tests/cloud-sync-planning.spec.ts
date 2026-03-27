import { expect, test } from '@playwright/test';
import { planProjectSyncAction, planRevisionSyncAction } from '../../../convex/projects';

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
      reason: 'already in sync',
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
});
