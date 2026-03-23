import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@convex-generated/api';

const LEASE_HEARTBEAT_INTERVAL_MS = 10_000;
const EDITOR_SESSION_STORAGE_KEY = 'pochacoding.editorSessionId';

type LeaseUiStatus = 'idle' | 'acquiring' | 'active' | 'blocked' | 'lost' | 'error';

type LeaseState = {
  status: LeaseUiStatus;
  activeEditorSessionId: string | null;
  staleAt: number | null;
};

function getOrCreateEditorSessionId(): string {
  if (typeof window === 'undefined') {
    return crypto.randomUUID();
  }

  try {
    const existing = window.sessionStorage.getItem(EDITOR_SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const next = crypto.randomUUID();
    window.sessionStorage.setItem(EDITOR_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

export function useProjectLease(projectLocalId: string | null) {
  const { isAuthenticated } = useConvexAuth();
  const acquireLeaseMutation = useMutation(api.projectEditorLeases.acquire);
  const heartbeatLeaseMutation = useMutation(api.projectEditorLeases.heartbeat);
  const releaseLeaseMutation = useMutation(api.projectEditorLeases.release);
  const editorSessionId = useMemo(() => getOrCreateEditorSessionId(), []);
  const [leaseState, setLeaseState] = useState<LeaseState>({
    status: projectLocalId ? 'acquiring' : 'idle',
    activeEditorSessionId: null,
    staleAt: null,
  });

  const queryStatus = useQuery(
    api.projectEditorLeases.getStatus,
    projectLocalId && isAuthenticated
      ? { projectLocalId, editorSessionId }
      : 'skip',
  );

  const heldLeaseRef = useRef<{ projectLocalId: string | null; isHeld: boolean }>({
    projectLocalId: null,
    isHeld: false,
  });

  const syncAcquireState = useCallback((result: {
    status: 'acquired' | 'taken_over' | 'blocked';
    activeEditorSessionId: string;
    staleAt: number;
  }): boolean => {
    if (result.status === 'blocked') {
      heldLeaseRef.current = { projectLocalId, isHeld: false };
      setLeaseState({
        status: 'blocked',
        activeEditorSessionId: result.activeEditorSessionId,
        staleAt: result.staleAt,
      });
      return false;
    }

    heldLeaseRef.current = { projectLocalId, isHeld: true };
    setLeaseState({
      status: 'active',
      activeEditorSessionId: result.activeEditorSessionId,
      staleAt: result.staleAt,
    });
    return true;
  }, [projectLocalId]);

  const acquireLease = useCallback(async (force: boolean): Promise<boolean> => {
    if (!projectLocalId || !isAuthenticated) {
      setLeaseState({ status: 'idle', activeEditorSessionId: null, staleAt: null });
      return false;
    }

    setLeaseState((current) => ({
      status: 'acquiring',
      activeEditorSessionId: current.activeEditorSessionId,
      staleAt: current.staleAt,
    }));

    try {
      const result = await acquireLeaseMutation({
        projectLocalId,
        editorSessionId,
        force,
      });
      return syncAcquireState(result);
    } catch (error) {
      console.error('[ProjectLease] Failed to acquire lease:', error);
      heldLeaseRef.current = { projectLocalId, isHeld: false };
      setLeaseState({
        status: 'error',
        activeEditorSessionId: null,
        staleAt: null,
      });
      return false;
    }
  }, [acquireLeaseMutation, editorSessionId, isAuthenticated, projectLocalId, syncAcquireState]);

  const takeOverLease = useCallback(async () => {
    return await acquireLease(true);
  }, [acquireLease]);

  const retryLease = useCallback(async () => {
    return await acquireLease(false);
  }, [acquireLease]);

  useEffect(() => {
    const previous = heldLeaseRef.current;
    if (previous.projectLocalId && previous.projectLocalId !== projectLocalId && previous.isHeld) {
      void releaseLeaseMutation({
        projectLocalId: previous.projectLocalId,
        editorSessionId,
      });
      heldLeaseRef.current = { projectLocalId: null, isHeld: false };
    }

    if (!projectLocalId || !isAuthenticated) {
      setLeaseState({ status: 'idle', activeEditorSessionId: null, staleAt: null });
      return;
    }

    void acquireLease(false);
  }, [acquireLease, editorSessionId, isAuthenticated, projectLocalId, releaseLeaseMutation]);

  useEffect(() => {
    if (!queryStatus) {
      return;
    }

    if (queryStatus.state === 'held_by_current') {
      heldLeaseRef.current = { projectLocalId, isHeld: true };
      setLeaseState(() => ({
        status: 'active',
        activeEditorSessionId: queryStatus.activeEditorSessionId,
        staleAt: queryStatus.staleAt,
      }));
      return;
    }

    if (queryStatus.state === 'held_by_other') {
      heldLeaseRef.current = { projectLocalId, isHeld: false };
      setLeaseState((current) => ({
        status: current.status === 'active' ? 'lost' : 'blocked',
        activeEditorSessionId: queryStatus.activeEditorSessionId,
        staleAt: queryStatus.staleAt,
      }));
      return;
    }

    if (leaseState.status === 'active') {
      heldLeaseRef.current = { projectLocalId, isHeld: false };
      setLeaseState({
        status: 'lost',
        activeEditorSessionId: null,
        staleAt: null,
      });
    }
  }, [leaseState.status, projectLocalId, queryStatus]);

  useEffect(() => {
    if (leaseState.status !== 'active' || !projectLocalId || !isAuthenticated) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const result = await heartbeatLeaseMutation({
            projectLocalId,
            editorSessionId,
          });
          if (!result.ok) {
            heldLeaseRef.current = { projectLocalId, isHeld: false };
            setLeaseState((current) => ({
              ...current,
              status: 'lost',
            }));
            return;
          }
          setLeaseState((current) => ({
            ...current,
            staleAt: result.staleAt,
          }));
        } catch (error) {
          console.error('[ProjectLease] Failed to heartbeat lease:', error);
        }
      })();
    }, LEASE_HEARTBEAT_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [editorSessionId, heartbeatLeaseMutation, isAuthenticated, leaseState.status, projectLocalId]);

  useEffect(() => {
    return () => {
      const heldLease = heldLeaseRef.current;
      if (!heldLease.projectLocalId || !heldLease.isHeld) {
        return;
      }
      void releaseLeaseMutation({
        projectLocalId: heldLease.projectLocalId,
        editorSessionId,
      });
    };
  }, [editorSessionId, releaseLeaseMutation]);

  return {
    editorSessionId,
    leaseStatus: leaseState.status,
    activeEditorSessionId: leaseState.activeEditorSessionId,
    staleAt: leaseState.staleAt,
    isWriteAllowed: leaseState.status === 'active',
    takeOverLease,
    retryLease,
  };
}
