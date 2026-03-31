import { useState, useCallback, useMemo, useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { SoundList } from './sound/SoundList';
import { WaveformEditor } from './sound/WaveformEditor';
import { RecordingStudio } from './sound/RecordingStudio';
import { getEffectiveObjectProps } from '@/types';
import type { Sound } from '@/types';
import { blobToDataUrl } from '@/utils/convexHelpers';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import { Button } from '@/components/ui/button';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import { Check, Loader2, RotateCcw } from '@/components/ui/icons';

interface DraftRecording {
  blob: Blob;
  url: string;
  name: string;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
}

export function SoundEditor() {
  const [selectedSoundIndex, setSelectedSoundIndex] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState<'edit' | 'record' | 'review'>('edit');
  const [draftRecording, setDraftRecording] = useState<DraftRecording | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();

  const scene = project?.scenes.find((s) => s.id === selectedSceneId);
  const object = scene?.objects.find((o) => o.id === selectedObjectId);

  // Get effective sounds (from component if applicable)
  const effectiveProps = useMemo(() => {
    if (!object || !project) return null;
    return getEffectiveObjectProps(object, project.components || []);
  }, [object, project]);

  const sounds = useMemo(() => effectiveProps?.sounds || [], [effectiveProps]);

  // Keep selected index in bounds
  const validSelectedIndex = Math.min(selectedSoundIndex, Math.max(0, sounds.length - 1));
  const selectedSound = sounds[validSelectedIndex] ?? null;
  const reviewSound = useMemo<Sound | null>(() => {
    if (!draftRecording) {
      return null;
    }

    return {
      id: 'draft-recording',
      name: draftRecording.name,
      assetId: draftRecording.url,
      duration: draftRecording.duration,
      trimStart: draftRecording.trimStart,
      trimEnd: draftRecording.trimEnd,
    };
  }, [draftRecording]);

  useEffect(() => {
    const draftUrl = draftRecording?.url;
    return () => {
      if (draftUrl) {
        URL.revokeObjectURL(draftUrl);
      }
    };
  }, [draftRecording?.url]);

  const handleSelectSound = useCallback((index: number) => {
    setDraftError(null);
    setSelectedSoundIndex(index);
    setWorkspaceMode('edit');
  }, []);

  const handleAddSound = useCallback(
    (sound: Sound) => {
      if (!selectedSceneId || !selectedObjectId) return;
      const updatedSounds = [...sounds, sound];
      updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });
      // Select the newly added sound
      setSelectedSoundIndex(updatedSounds.length - 1);
      setDraftRecording(null);
      setDraftError(null);
      setWorkspaceMode('edit');
    },
    [selectedSceneId, selectedObjectId, sounds, updateObject]
  );

  const handleDeleteSound = useCallback(
    (index: number) => {
      if (!selectedSceneId || !selectedObjectId) return;

      const updatedSounds = sounds.filter((_, i) => i !== index);
      updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });

      // Adjust selected index if needed
      if (index <= validSelectedIndex && validSelectedIndex > 0) {
        setSelectedSoundIndex(validSelectedIndex - 1);
      }
    },
    [selectedSceneId, selectedObjectId, sounds, validSelectedIndex, updateObject]
  );

  const handleRenameSound = useCallback(
    (index: number, newName: string) => {
      if (!selectedSceneId || !selectedObjectId) return;
      const updatedSounds = sounds.map((s, i) =>
        i === index ? { ...s, name: newName } : s
      );
      updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });
    },
    [selectedSceneId, selectedObjectId, sounds, updateObject]
  );

  const handleTrimChange = useCallback(
    (trimStart: number, trimEnd: number) => {
      if (!selectedSceneId || !selectedObjectId || !selectedSound) return;
      const updatedSounds = sounds.map((s, i) =>
        i === validSelectedIndex ? { ...s, trimStart, trimEnd } : s
      );
      updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });
    },
    [selectedSceneId, selectedObjectId, selectedSound, sounds, validSelectedIndex, updateObject]
  );

  const handleReviewTrimChange = useCallback((trimStart: number, trimEnd: number) => {
    setDraftRecording((currentDraft) => currentDraft ? { ...currentDraft, trimStart, trimEnd } : currentDraft);
  }, []);

  const handleReviewRecording = useCallback((draft: DraftRecording) => {
    setDraftError(null);
    setDraftRecording((currentDraft) => {
      if (currentDraft?.url && currentDraft.url !== draft.url) {
        URL.revokeObjectURL(currentDraft.url);
      }
      return draft;
    });
    setWorkspaceMode('review');
  }, []);

  const handleRerecord = useCallback(() => {
    setDraftError(null);
    setDraftRecording((currentDraft) => {
      if (currentDraft?.url) {
        URL.revokeObjectURL(currentDraft.url);
      }
      return null;
    });
    setWorkspaceMode('record');
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!draftRecording) {
      return;
    }

    setIsSavingDraft(true);
    setDraftError(null);

    try {
      const rawDataUrl = await blobToDataUrl(draftRecording.blob);
      const normalizedDataUrl = draftRecording.blob.type.includes('webm')
        ? rawDataUrl
        : await compressAudio(rawDataUrl);
      const resolvedDuration = await getAudioDuration(normalizedDataUrl) ?? draftRecording.duration ?? 0;

      handleAddSound({
        id: crypto.randomUUID(),
        name: draftRecording.name,
        assetId: normalizedDataUrl,
        duration: resolvedDuration || undefined,
        trimStart: draftRecording.trimStart && draftRecording.trimStart > 0.001 ? draftRecording.trimStart : undefined,
        trimEnd: draftRecording.trimEnd && resolvedDuration > 0 && draftRecording.trimEnd < resolvedDuration - 0.001
          ? draftRecording.trimEnd
          : undefined,
      });
    } catch (error) {
      console.error('Failed to add recording to project:', error);
      setDraftError('The recording could not be added to the project.');
    } finally {
      setIsSavingDraft(false);
    }
  }, [draftRecording, handleAddSound]);

  const editorFooter = workspaceMode === 'review' ? (
    <div className="flex flex-col gap-4">
      {draftError ? (
        <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-5 shadow-sm">
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {draftError}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-4 shadow-sm">
        <Button variant="outline" className="rounded-full" onClick={handleRerecord}>
          <RotateCcw className="size-4" />
          Re-record
        </Button>
        <Button className="rounded-full px-5" onClick={handleSaveDraft} disabled={isSavingDraft}>
          {isSavingDraft ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save
        </Button>
      </div>
    </div>
  ) : undefined;

  if (!object) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {NO_OBJECT_SELECTED_MESSAGE}
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">
      <SoundList
        sounds={sounds}
        selectedIndex={validSelectedIndex}
        onOpenRecorder={() => {
          setDraftError(null);
          setWorkspaceMode('record');
        }}
        onSelectSound={handleSelectSound}
        onAddSound={handleAddSound}
        onDeleteSound={handleDeleteSound}
        onRenameSound={handleRenameSound}
      />

      {workspaceMode === 'record' ? (
        <RecordingStudio onReviewRecording={handleReviewRecording} />
      ) : (
        <WaveformEditor
          sound={workspaceMode === 'review' ? reviewSound : selectedSound}
          onTrimChange={workspaceMode === 'review' ? handleReviewTrimChange : handleTrimChange}
          onCreateRecording={() => {
            setDraftError(null);
            setWorkspaceMode('record');
          }}
          footer={editorFooter}
        />
      )}
    </div>
  );
}
