import { useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Plus, Play, Square, Trash2 } from 'lucide-react';
import type { Sound } from '@/types';

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
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
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
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-sm font-medium">
          Sounds for {object.name}
        </span>
        <Button onClick={handleAddSound} size="sm">
          <Plus className="size-4" />
          Add Sound
        </Button>
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
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <div className="text-4xl mb-2">🔊</div>
            <p className="text-sm">No sounds yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Add Sound" to upload audio files</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sounds.map((sound, index) => (
              <Card
                key={sound.id}
                className="flex items-center gap-3 p-3 group"
              >
                {/* Play button */}
                <Button
                  variant={playingId === sound.id ? 'default' : 'secondary'}
                  size="icon"
                  onClick={() => handlePlaySound(sound)}
                  className="shrink-0"
                >
                  {playingId === sound.id ? (
                    <Square className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>

                {/* Sound name */}
                <Input
                  value={sound.name}
                  onChange={(e) => handleRenameSound(index, e.target.value)}
                  className="flex-1 h-8"
                />

                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDeleteSound(index)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
