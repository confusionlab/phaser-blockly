import { useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import type { Sound } from '../../types';

export function SoundEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const object = scene?.objects.find(o => o.id === selectedObjectId);

  if (!object) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Select an object to edit sounds
      </div>
    );
  }

  // Handle legacy objects without sounds array
  const sounds: Sound[] = object.sounds || [];

  const handleAddSound = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedSceneId || !selectedObjectId) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/')) continue;

      // Create a data URL for the audio
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const newSound: Sound = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
          assetId: dataUrl, // Store data URL directly for now
        };

        const updatedSounds = [...sounds, newSound];
        updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });
      };
      reader.readAsDataURL(file);
    }

    // Reset input
    e.target.value = '';
  };

  const handlePlaySound = (sound: Sound) => {
    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingId === sound.id) {
      setPlayingId(null);
      return;
    }

    // Play new audio
    const audio = new Audio(sound.assetId);
    audio.onended = () => setPlayingId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingId(sound.id);
  };

  const handleDeleteSound = (index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;

    // Stop if this sound is playing
    if (sounds[index]?.id === playingId) {
      audioRef.current?.pause();
      setPlayingId(null);
    }

    const updatedSounds = sounds.filter((_, i) => i !== index);
    updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });
  };

  const handleRenameSound = (index: number, newName: string) => {
    if (!selectedSceneId || !selectedObjectId) return;
    const updatedSounds = sounds.map((s, i) =>
      i === index ? { ...s, name: newName } : s
    );
    updateObject(selectedSceneId, selectedObjectId, { sounds: updatedSounds });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">
          Sounds for {object.name}
        </span>
        <button
          onClick={handleAddSound}
          className="px-3 py-1.5 bg-[var(--color-primary)] text-white text-sm rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          + Add Sound
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Sound List */}
      <div className="flex-1 overflow-y-auto p-4">
        {sounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-4xl mb-2">🔊</div>
            <p className="text-sm">No sounds yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add Sound" to upload audio files</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sounds.map((sound, index) => (
              <div
                key={sound.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors group"
              >
                {/* Play button */}
                <button
                  onClick={() => handlePlaySound(sound)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    playingId === sound.id
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  }`}
                >
                  {playingId === sound.id ? (
                    <StopIcon />
                  ) : (
                    <PlayIcon />
                  )}
                </button>

                {/* Sound name */}
                <input
                  type="text"
                  value={sound.name}
                  onChange={(e) => handleRenameSound(index, e.target.value)}
                  className="flex-1 text-sm bg-transparent border-none focus:outline-none focus:bg-white focus:ring-1 focus:ring-[var(--color-primary)] rounded px-2 py-1"
                />

                {/* Delete button */}
                <button
                  onClick={() => handleDeleteSound(index)}
                  className="w-8 h-8 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
    </svg>
  );
}
