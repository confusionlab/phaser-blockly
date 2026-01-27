import { PhaserCanvas } from './PhaserCanvas';
import { SpriteShelf } from './SpriteShelf';
import { SceneTabs } from './SceneTabs';
import { ObjectInspector } from './ObjectInspector';
import { useEditorStore } from '../../store/editorStore';

interface StagePanelProps {
  fullscreen?: boolean;
}

export function StagePanel({ fullscreen = false }: StagePanelProps) {
  const { stopPlaying } = useEditorStore();

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={stopPlaying}
            className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors flex items-center gap-2"
          >
            <StopIcon />
            Stop
          </button>
        </div>
        <div className="flex-1">
          <PhaserCanvas isPlaying={true} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-main)]">
      {/* Scene tabs */}
      <SceneTabs />

      {/* Phaser canvas */}
      <div className="flex-1 min-h-0 p-4">
        <div className="relative w-full h-full bg-white rounded-lg shadow-sm overflow-hidden">
          <PhaserCanvas isPlaying={false} />
        </div>
      </div>

      {/* Object inspector */}
      <ObjectInspector />

      {/* Sprite shelf */}
      <SpriteShelf />
    </div>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}
