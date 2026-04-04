import type { MutableRefObject } from 'react';

export interface LocalHistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
}

function cloneNullableSnapshot<T>(
  snapshot: T | null | undefined,
  clone: (snapshot: T) => T,
): T | null {
  if (snapshot == null) {
    return null;
  }
  return clone(snapshot);
}

export function getLinearLocalHistoryAvailability(
  historyIndex: number,
  historyLength: number,
): LocalHistoryAvailability {
  return {
    canUndo: historyIndex > 0,
    canRedo: historyIndex >= 0 && historyIndex < historyLength - 1,
    isDirty: historyIndex > 0,
  };
}

export function clearLinearLocalHistory<T>(
  snapshotsRef: MutableRefObject<T[]>,
  indexRef: MutableRefObject<number>,
): void {
  snapshotsRef.current = [];
  indexRef.current = -1;
}

export function rebaseLinearLocalHistoryToSnapshot<T>(
  snapshot: T | null | undefined,
  snapshotsRef: MutableRefObject<T[]>,
  indexRef: MutableRefObject<number>,
): void {
  if (snapshot == null) {
    clearLinearLocalHistory(snapshotsRef, indexRef);
    return;
  }

  snapshotsRef.current = [snapshot];
  indexRef.current = 0;
}

export function appendLinearLocalHistorySnapshot<T>(
  snapshot: T | null | undefined,
  snapshotsRef: MutableRefObject<T[]>,
  indexRef: MutableRefObject<number>,
  equals: (a: T | null | undefined, b: T | null | undefined) => boolean,
): boolean {
  if (snapshot == null) {
    return false;
  }

  const currentSnapshot = snapshotsRef.current[indexRef.current] ?? null;
  if (equals(snapshot, currentSnapshot)) {
    return false;
  }

  const nextHistory = snapshotsRef.current.slice(0, indexRef.current + 1);
  nextHistory.push(snapshot);
  snapshotsRef.current = nextHistory;
  indexRef.current = nextHistory.length - 1;
  return true;
}

export function markPersistedSnapshotBaseline<T>(
  snapshot: T | null | undefined,
  persistedRef: MutableRefObject<T | null>,
  clone: (snapshot: T) => T,
): void {
  persistedRef.current = cloneNullableSnapshot(snapshot, clone);
}

export function rebaseCommittedSnapshotBaseline<T>(
  snapshot: T | null | undefined,
  lastCommittedRef: MutableRefObject<T | null>,
  persistedRef: MutableRefObject<T | null>,
  clone: (snapshot: T) => T,
): void {
  const clonedSnapshot = cloneNullableSnapshot(snapshot, clone);
  lastCommittedRef.current = clonedSnapshot;
  persistedRef.current = cloneNullableSnapshot(clonedSnapshot, clone);
}

export function commitCommittedSnapshotBaseline<T>(
  snapshot: T | null | undefined,
  lastCommittedRef: MutableRefObject<T | null>,
  equals: (a: T | null | undefined, b: T | null | undefined) => boolean,
  clone: (snapshot: T) => T,
): boolean {
  if (snapshot == null || equals(snapshot, lastCommittedRef.current)) {
    return false;
  }

  lastCommittedRef.current = clone(snapshot);
  return true;
}
