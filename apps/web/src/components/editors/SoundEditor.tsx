import { useRef, useState, useCallback, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { SoundList } from './sound/SoundList';
import { WaveformEditor } from './sound/WaveformEditor';
import { RecordingStudio } from './sound/RecordingStudio';
import { getEffectiveObjectProps } from '@/types';
import type { Sound } from '@/types';

export function SoundEditor() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedSoundIndex, setSelectedSoundIndex] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState<'edit' | 'record'>('edit');

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

  const handleSelectSound = useCallback((index: number) => {
    // Stop playback when switching sounds
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
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
      setWorkspaceMode('edit');
    },
    [selectedSceneId, selectedObjectId, sounds, updateObject]
  );

  const handleDeleteSound = useCallback(
    (index: number) => {
      if (!selectedSceneId || !selectedObjectId) return;

      // Stop if this sound is playing
      if (sounds[index]?.id === playingId) {
        audioRef.current?.pause();
        setPlayingId(null);
      }

      const updatedSounds = sounds.filter((_, i) => i !== index);
      updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });

      // Adjust selected index if needed
      if (index <= validSelectedIndex && validSelectedIndex > 0) {
        setSelectedSoundIndex(validSelectedIndex - 1);
      }
    },
    [selectedSceneId, selectedObjectId, sounds, playingId, validSelectedIndex, updateObject]
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

  const handlePlaySound = useCallback((sound: Sound) => {
    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingId === sound.id) {
      setPlayingId(null);
      return;
    }

    // Play new audio (respect trim settings)
    const audio = new Audio(sound.assetId);
    audio.currentTime = sound.trimStart ?? 0;
    audio.onended = () => setPlayingId(null);
    audio.ontimeupdate = () => {
      if (sound.trimEnd && audio.currentTime >= sound.trimEnd) {
        audio.pause();
        setPlayingId(null);
      }
    };
    void audio.play().catch((error) => {
      console.error('Failed to play sound preview:', error);
      setPlayingId(null);
    });
    audioRef.current = audio;
    setPlayingId(sound.id);
  }, [playingId]);

  const handleStopSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

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

  if (!object) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select an object to edit sounds
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">
      {/* Left: Sound List */}
      <SoundList
        sounds={sounds}
        selectedIndex={validSelectedIndex}
        playingId={playingId}
        onOpenRecorder={() => setWorkspaceMode('record')}
        onSelectSound={handleSelectSound}
        onAddSound={handleAddSound}
        onDeleteSound={handleDeleteSound}
        onRenameSound={handleRenameSound}
        onPlaySound={handlePlaySound}
        onStopSound={handleStopSound}
      />

      {workspaceMode === 'record' ? (
        <RecordingStudio
          onAddSound={handleAddSound}
          onCancel={() => setWorkspaceMode('edit')}
        />
      ) : (
        <WaveformEditor
          sound={selectedSound}
          onTrimChange={handleTrimChange}
          onCreateRecording={() => setWorkspaceMode('record')}
        />
      )}
    </div>
  );
}
