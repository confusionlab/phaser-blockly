import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '@/types';
import {
  createManualCheckpoint,
  listProjectRevisions,
  renameCheckpoint,
  restoreAsNewProject,
  type ProjectRevision,
} from '@/db/database';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NameInputDialog } from '@/components/dialogs/NameInputDialog';
import { useCloudSync } from '@/hooks/useCloudSync';
import { useModal } from '@/components/ui/modal-provider';

type HistoryFilter = 'all' | 'manual';
type CheckpointDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; revisionId: string };

interface ProjectHistoryDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestoredProject: (project: Project) => void;
}

const REASON_LABEL: Record<ProjectRevision['reason'], string> = {
  manual_checkpoint: 'Manual Checkpoint',
  auto_checkpoint: 'Auto Checkpoint',
  import: 'Import',
  restore: 'Restore',
  edit_revision: 'Edit',
};

function formatRevisionDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

export function ProjectHistoryDialog({
  project,
  open,
  onOpenChange,
  onRestoredProject,
}: ProjectHistoryDialogProps) {
  const { syncProjectToCloud } = useCloudSync({
    currentProjectId: project?.id ?? null,
    syncOnMount: false,
    syncOnUnmount: false,
    enableCloudProjectListQuery: false,
    checkpointIntervalMs: 0,
    backgroundSyncDebounceMs: 0,
  });
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checkpointDialogState, setCheckpointDialogState] = useState<CheckpointDialogState | null>(null);
  const [checkpointNameDraft, setCheckpointNameDraft] = useState('');
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const { showAlert, showConfirm } = useModal();

  const reload = useCallback(async () => {
    if (!project) {
      setRevisions([]);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const next = await listProjectRevisions(project.id, {
        manualCheckpointsOnly: filter === 'manual',
      });
      setRevisions(next);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load history.');
    } finally {
      setLoading(false);
    }
  }, [filter, project]);

  useEffect(() => {
    if (open) {
      void reload();
    }
  }, [open, reload]);

  const title = useMemo(() => {
    if (!project) return 'Version History';
    return `Version History - ${project.name}`;
  }, [project]);

  const handleRenameCheckpoint = useCallback(async (revision: ProjectRevision) => {
    setCheckpointDialogState({ mode: 'rename', revisionId: revision.id });
    setCheckpointNameDraft(revision.checkpointName ?? '');
    setCheckpointError(null);
  }, []);

  const handleCreateCheckpoint = useCallback(async () => {
    setCheckpointDialogState({ mode: 'create' });
    setCheckpointNameDraft('');
    setCheckpointError(null);
  }, []);

  const handleCheckpointDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      return;
    }

    setCheckpointDialogState(null);
    setCheckpointNameDraft('');
    setCheckpointError(null);
  }, []);

  const handleSubmitCheckpointName = useCallback(async () => {
    if (!project || !checkpointDialogState) return;

    const normalized = checkpointNameDraft.trim();
    if (!normalized) {
      setCheckpointError('Checkpoint name cannot be empty.');
      return;
    }

    try {
      if (checkpointDialogState.mode === 'create') {
        const created = await createManualCheckpoint(project, normalized);
        if (!created) {
          await showAlert({
            title: 'Nothing New To Save',
            description: 'No content changes since the latest revision, but your project is still safe with autosave.',
          });
        } else {
          void syncProjectToCloud(project.id);
        }
      } else {
        await renameCheckpoint(project.id, checkpointDialogState.revisionId, normalized);
        void syncProjectToCloud(project.id);
      }

      setCheckpointDialogState(null);
      setCheckpointNameDraft('');
      setCheckpointError(null);
      await reload();
    } catch (error) {
      setCheckpointError(
        error instanceof Error
          ? error.message
          : (checkpointDialogState.mode === 'create'
            ? 'Failed to create checkpoint.'
            : 'Failed to rename checkpoint.'),
      );
    }
  }, [checkpointDialogState, checkpointNameDraft, project, reload, syncProjectToCloud]);

  const handleRestore = useCallback(async (revision: ProjectRevision) => {
    if (!project) return;

    const label = revision.checkpointName || formatRevisionDate(revision.createdAt);
    const confirmed = await showConfirm({
      title: 'Restore As New Project',
      description: `Restore as new project from "${label}"? This creates a new copy and keeps your current project unchanged.`,
      confirmLabel: 'Restore Copy',
    });
    if (!confirmed) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      const restoredProject = await restoreAsNewProject(project.id, revision.id);
      onRestoredProject(restoredProject);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to restore revision.');
    } finally {
      setLoading(false);
    }
  }, [onOpenChange, onRestoredProject, project, showConfirm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCreateCheckpoint()}
            disabled={loading || !project}
          >
            Create Checkpoint
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          <Button
            variant={filter === 'manual' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('manual')}
          >
            Manual Checkpoints
          </Button>
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded-md border">
          {loading && revisions.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Loading revision history...</div>
          ) : revisions.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No revision history yet.</div>
          ) : (
            <div className="divide-y">
              {revisions.map((revision) => (
                <div key={revision.id} className="p-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {revision.isCheckpoint && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary">
                          Checkpoint
                        </span>
                      )}
                      <span className="text-sm font-medium">{REASON_LABEL[revision.reason]}</span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {formatRevisionDate(revision.createdAt)}
                    </div>
                    {revision.checkpointName && (
                      <div className="text-sm mt-1">{revision.checkpointName}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {revision.isCheckpoint && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRenameCheckpoint(revision)}
                        disabled={loading}
                      >
                        Rename
                      </Button>
                    )}
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => void handleRestore(revision)}
                      disabled={loading}
                    >
                      Restore
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {errorMessage && <div className="text-sm text-destructive">{errorMessage}</div>}
      </DialogContent>
      <NameInputDialog
        open={checkpointDialogState !== null}
        title={checkpointDialogState?.mode === 'create' ? 'Create Checkpoint' : 'Rename Checkpoint'}
        label="Checkpoint name"
        value={checkpointNameDraft}
        submitLabel={checkpointDialogState?.mode === 'create' ? 'Create Checkpoint' : 'Save'}
        error={checkpointError}
        onValueChange={(value) => {
          setCheckpointNameDraft(value);
          setCheckpointError(null);
        }}
        onOpenChange={handleCheckpointDialogOpenChange}
        onSubmit={() => {
          void handleSubmitCheckpointName();
        }}
      />
    </Dialog>
  );
}
