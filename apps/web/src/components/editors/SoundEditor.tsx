import { useState, useCallback, useMemo, useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { SoundList } from './sound/SoundList';
import { WaveformEditor } from './sound/WaveformEditor';
import { RecordingStudio } from './sound/RecordingStudio';
import { useBulkAssetSelection } from './shared/useBulkAssetSelection';
import { getEffectiveObjectProps } from '@/types';
import type { Sound } from '@/types';
import { blobToDataUrl } from '@/utils/convexHelpers';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import { Button } from '@/components/ui/button';
import {
  reorderAssetList,
  resolveNextActiveAssetIdAfterRemoval,
} from '@/lib/editor/assetSidebarList';
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
  const [activeSoundId, setActiveSoundId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'edit' | 'record' | 'review'>('edit');
  const [draftRecording, setDraftRecording] = useState<DraftRecording | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const { project, updateObject, updateComponent } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedComponentId } = useEditorStore();

  const scene = project?.scenes.find((s) => s.id === selectedSceneId);
  const object = scene?.objects.find((o) => o.id === selectedObjectId);
  const component = (project?.components || []).find((item) => item.id === selectedComponentId);

  // Get effective sounds (from component if applicable)
  const effectiveProps = useMemo(() => {
    if (component) {
      return {
        blocklyXml: component.blocklyXml,
        costumes: component.costumes,
        currentCostumeIndex: component.currentCostumeIndex,
        physics: component.physics,
        collider: component.collider,
        sounds: component.sounds,
      };
    }
    if (!object || !project) return null;
    return getEffectiveObjectProps(object, project.components || []);
  }, [component, object, project]);

  const sounds = useMemo(() => effectiveProps?.sounds || [], [effectiveProps]);
  const hasSounds = sounds.length > 0;
  const orderedSoundIds = useMemo(() => sounds.map((sound) => sound.id), [sounds]);
  const resolvedActiveSoundId = useMemo(() => {
    if (activeSoundId && orderedSoundIds.includes(activeSoundId)) {
      return activeSoundId;
    }
    return orderedSoundIds[0] ?? null;
  }, [activeSoundId, orderedSoundIds]);
  const activeSoundIndex = resolvedActiveSoundId
    ? sounds.findIndex((sound) => sound.id === resolvedActiveSoundId)
    : -1;
  const selectedSound = activeSoundIndex >= 0 ? sounds[activeSoundIndex] ?? null : null;
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
    if (resolvedActiveSoundId !== activeSoundId) {
      setActiveSoundId(resolvedActiveSoundId);
    }
  }, [activeSoundId, resolvedActiveSoundId]);

  const {
    selectedIds: selectedSoundIds,
    replaceSelection: replaceSelectedSoundIds,
    handleItemClick: handleSoundListClick,
    prepareDragSelection: prepareSoundDragSelection,
  } = useBulkAssetSelection({
    orderedIds: orderedSoundIds,
    activeId: resolvedActiveSoundId,
    onActivate: (soundId) => {
      setDraftError(null);
      setActiveSoundId(soundId);
      setWorkspaceMode('edit');
    },
  });

  useEffect(() => {
    const draftUrl = draftRecording?.url;
    return () => {
      if (draftUrl) {
        URL.revokeObjectURL(draftUrl);
      }
    };
  }, [draftRecording?.url]);

  const handleAddSound = useCallback(
    (sound: Sound) => {
      if (selectedComponentId) {
        const updatedSounds = [...sounds, sound];
        updateComponent(selectedComponentId, { sounds: updatedSounds });
        setActiveSoundId(sound.id);
        replaceSelectedSoundIds([sound.id], { anchorId: sound.id });
        setDraftRecording(null);
        setDraftError(null);
        setWorkspaceMode('edit');
        return;
      }
      if (!selectedSceneId || !selectedObjectId) return;
      const updatedSounds = [...sounds, sound];
      updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });
      setActiveSoundId(sound.id);
      replaceSelectedSoundIds([sound.id], { anchorId: sound.id });
      setDraftRecording(null);
      setDraftError(null);
      setWorkspaceMode('edit');
    },
    [
      replaceSelectedSoundIds,
      selectedComponentId,
      selectedObjectId,
      selectedSceneId,
      sounds,
      updateComponent,
      updateObject,
    ],
  );

  const updateSounds = useCallback((nextSounds: Sound[]) => {
    if (selectedComponentId) {
      updateComponent(selectedComponentId, { sounds: nextSounds });
      return;
    }
    if (!selectedSceneId || !selectedObjectId) {
      return;
    }
    updateObject(selectedSceneId, selectedObjectId, { sounds: nextSounds });
  }, [selectedComponentId, selectedObjectId, selectedSceneId, updateComponent, updateObject]);

  const handleDeleteSounds = useCallback((soundIds: string[]) => {
    const uniqueSoundIds = Array.from(new Set(soundIds));
    if (uniqueSoundIds.length === 0) {
      return;
    }

    const updatedSounds = sounds.filter((sound) => !uniqueSoundIds.includes(sound.id));
    if (updatedSounds.length === sounds.length) {
      return;
    }

    const nextActiveSoundId = resolveNextActiveAssetIdAfterRemoval(
      orderedSoundIds,
      resolvedActiveSoundId,
      uniqueSoundIds,
    );
    setActiveSoundId(nextActiveSoundId);
    updateSounds(updatedSounds);
    setDraftError(null);
    setWorkspaceMode(updatedSounds.length === 0 ? 'record' : 'edit');
  }, [orderedSoundIds, resolvedActiveSoundId, sounds, updateSounds]);

  const handleRenameSound = useCallback(
    (soundId: string, newName: string) => {
      const updatedSounds = sounds.map((sound) =>
        sound.id === soundId ? { ...sound, name: newName } : sound
      );
      updateSounds(updatedSounds);
    },
    [sounds, updateSounds],
  );

  const handleTrimChange = useCallback(
    (trimStart: number, trimEnd: number) => {
      if (!selectedSound || !resolvedActiveSoundId) {
        return;
      }

      const updatedSounds = sounds.map((sound) =>
        sound.id === resolvedActiveSoundId ? { ...sound, trimStart, trimEnd } : sound
      );
      updateSounds(updatedSounds);
    },
    [resolvedActiveSoundId, selectedSound, sounds, updateSounds]
  );

  const handleReorderSounds = useCallback((soundIds: string[], targetIndex: number) => {
    const updatedSounds = reorderAssetList(sounds, soundIds, targetIndex);
    if (!updatedSounds) {
      return;
    }
    updateSounds(updatedSounds);
  }, [sounds, updateSounds]);

  const handleReplaceSounds = useCallback((
    nextSounds: Sound[],
    nextActiveSoundId: string | null,
    nextSelectedSoundIds: string[],
  ) => {
    updateSounds(nextSounds);
    setActiveSoundId(nextActiveSoundId);
    replaceSelectedSoundIds(
      nextSelectedSoundIds,
      { anchorId: nextSelectedSoundIds[0] ?? nextActiveSoundId },
    );
    setDraftError(null);
    setWorkspaceMode(nextSounds.length === 0 ? 'record' : 'edit');
  }, [replaceSelectedSoundIds, updateSounds]);

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
        <div className="pointer-events-auto rounded-[24px] border border-border/70 bg-surface-floating p-4 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45),0_6px_18px_-14px_rgba(15,23,42,0.24)] backdrop-blur-xl">
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {draftError}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-auto flex items-center justify-center gap-2 rounded-full border border-border/70 bg-surface-floating p-2 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.5),0_8px_20px_-16px_rgba(15,23,42,0.28)] backdrop-blur-xl">
        <Button shape="pill" variant="outline" onClick={handleRerecord}>
          <RotateCcw className="size-4" />
          Re-record
        </Button>
        <Button className="px-5" shape="pill" onClick={handleSaveDraft} disabled={isSavingDraft}>
          {isSavingDraft ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save
        </Button>
      </div>
    </div>
  ) : undefined;

  if (!object && !component) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {NO_OBJECT_SELECTED_MESSAGE}
      </div>
    );
  }

  const showRecorder = workspaceMode === 'record' || (workspaceMode === 'edit' && !hasSounds);

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">
      <SoundList
        sounds={sounds}
        activeSoundId={resolvedActiveSoundId}
        selectedSoundIds={selectedSoundIds}
        onOpenRecorder={() => {
          setDraftError(null);
          setWorkspaceMode('record');
        }}
        onSelectSound={handleSoundListClick}
        onAddSound={handleAddSound}
        onDeleteSounds={handleDeleteSounds}
        onRenameSound={handleRenameSound}
        onReplaceSounds={handleReplaceSounds}
        onPrepareSoundDrag={prepareSoundDragSelection}
        onReorderSounds={handleReorderSounds}
      />

      {showRecorder ? (
        <RecordingStudio onReviewRecording={handleReviewRecording} />
      ) : (
        <WaveformEditor
          sound={workspaceMode === 'review' ? reviewSound : selectedSound}
          onTrimChange={workspaceMode === 'review' ? handleReviewTrimChange : handleTrimChange}
          footer={editorFooter}
        />
      )}
    </div>
  );
}
