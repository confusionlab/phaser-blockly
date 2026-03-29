import { expect, test } from '@playwright/test';
import { createBitmapCostumeDocument } from '../src/lib/costume/costumeDocument';
import { CostumeEditorCoordinator } from '../src/lib/editor/costumeEditorCoordinator';
import {
  createCostumeEditorSession,
  type CostumeEditorPersistedState,
} from '../src/lib/editor/costumeEditorSession';

function createState(assetId: string): CostumeEditorPersistedState {
  return {
    assetId,
    document: createBitmapCostumeDocument(assetId, 'Layer 1'),
  };
}

test.describe('costume editor coordinator', () => {
  test('history navigation commits keep future revisions intact', () => {
    const coordinator = new CostumeEditorCoordinator();
    const session = createCostumeEditorSession({
      sceneId: 'scene-1',
      objectId: 'object-1',
      costumeId: 'costume-1',
    });
    const fillState = createState('data:image/png;base64,FILL');
    const strokeOneState = createState('data:image/png;base64,STROKE_ONE');
    const strokeTwoState = createState('data:image/png;base64,STROKE_TWO');

    coordinator.resetDocumentHistory(session, fillState);
    coordinator.commitRuntimeState(session, strokeOneState, {
      historyAction: 'push',
      syncMode: 'stateOnly',
    });
    coordinator.commitRuntimeState(session, strokeTwoState, {
      historyAction: 'push',
      syncMode: 'stateOnly',
    });

    expect(coordinator.canUndo()).toBe(true);
    expect(coordinator.canRedo()).toBe(false);

    coordinator.setHistoryIndex(1);
    coordinator.commitRuntimeState(session, strokeOneState, {
      historyAction: 'none',
      syncMode: 'render',
    });
    coordinator.setHistoryIndex(0);
    coordinator.commitRuntimeState(session, fillState, {
      historyAction: 'none',
      syncMode: 'render',
    });

    expect(coordinator.getHistorySnapshot(0)?.assetId).toBe(fillState.assetId);
    expect(coordinator.getHistorySnapshot(1)?.assetId).toBe(strokeOneState.assetId);
    expect(coordinator.getHistorySnapshot(2)?.assetId).toBe(strokeTwoState.assetId);
    expect(coordinator.canRedo()).toBe(true);

    coordinator.dispose();
  });

  test('flush sync persists only the latest revision once', () => {
    const coordinator = new CostumeEditorCoordinator();
    const session = createCostumeEditorSession({
      sceneId: 'scene-1',
      objectId: 'object-1',
      costumeId: 'costume-1',
    });
    const persistedEntries: Array<{ assetId: string; revision: number }> = [];

    coordinator.setCallbacks({
      persistStateToStore: (entry, state) => {
        persistedEntries.push({
          revision: entry.revision,
          assetId: state.assetId,
        });
        return true;
      },
    });

    coordinator.resetDocumentHistory(session, createState('data:image/png;base64,FILL'));
    const latestEntry = coordinator.commitRuntimeState(session, createState('data:image/png;base64,STROKE_TWO'), {
      historyAction: 'push',
      syncMode: 'render',
    });

    expect(latestEntry).not.toBeNull();
    expect(coordinator.flushPendingRuntimeStateSync({ session })).toBe(true);
    expect(coordinator.flushPendingRuntimeStateSync({ session })).toBe(false);
    expect(persistedEntries).toEqual([
      {
        revision: latestEntry?.revision ?? -1,
        assetId: 'data:image/png;base64,STROKE_TWO',
      },
    ]);

    coordinator.dispose();
  });

  test('working state and flushes stay scoped to the active session key', () => {
    const coordinator = new CostumeEditorCoordinator();
    const sessionA = createCostumeEditorSession({
      sceneId: 'scene-1',
      objectId: 'object-1',
      costumeId: 'costume-a',
    });
    const sessionB = createCostumeEditorSession({
      sceneId: 'scene-1',
      objectId: 'object-1',
      costumeId: 'costume-b',
    });
    const persistedEntries: string[] = [];

    coordinator.setCallbacks({
      persistStateToStore: (_entry, state) => {
        persistedEntries.push(state.assetId);
        return true;
      },
    });

    coordinator.resetDocumentHistory(sessionA, createState('data:image/png;base64,A_BASE'));
    coordinator.commitRuntimeState(sessionA, createState('data:image/png;base64,A_EDITED'), {
      historyAction: 'push',
      syncMode: 'render',
    });

    expect(coordinator.flushPendingRuntimeStateSync({ session: sessionB })).toBe(false);
    expect(persistedEntries).toEqual([]);
    expect(coordinator.getWorkingPersistedStateForSession(sessionA)?.assetId).toBe('data:image/png;base64,A_EDITED');

    coordinator.resetDocumentHistory(sessionB, createState('data:image/png;base64,B_BASE'));

    expect(coordinator.getWorkingPersistedStateForSession(sessionA)).toBeNull();
    expect(coordinator.getWorkingPersistedStateForSession(sessionB)?.assetId).toBe('data:image/png;base64,B_BASE');

    coordinator.dispose();
  });
});
