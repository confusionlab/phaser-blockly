import { useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { AssetLibrary } from '../dialogs/AssetLibrary';

export function Toolbar() {
  const { project, isDirty, saveCurrentProject } = useProjectStore();
  const { isPlaying, startPlaying, stopPlaying, setShowProjectDialog } = useEditorStore();
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);

  const handleSave = async () => {
    await saveCurrentProject();
  };

  const handlePlay = () => {
    if (isPlaying) {
      stopPlaying();
    } else {
      startPlaying();
    }
  };

  return (
    <div className="flex items-center justify-between h-12 px-4 bg-white border-b border-[var(--color-border)]">
      {/* Left section - Logo and project name */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[var(--color-primary)] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">PB</span>
          </div>
          <span className="font-semibold text-[var(--color-primary)]">PhaserBlockly</span>
        </div>

        {project && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400">|</span>
            <span className="font-medium">{project.name}</span>
            {isDirty && <span className="text-gray-400">*</span>}
          </div>
        )}
      </div>

      {/* Center section - Play controls */}
      <div className="flex items-center gap-2">
        {project && (
          <>
            <button
              onClick={handlePlay}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                isPlaying
                  ? 'bg-[var(--color-danger)] text-white hover:bg-red-600'
                  : 'bg-[var(--color-success)] text-white hover:bg-green-600'
              }`}
            >
              {isPlaying ? (
                <>
                  <StopIcon />
                  Stop
                </>
              ) : (
                <>
                  <PlayIcon />
                  Play
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Right section - Actions */}
      <div className="flex items-center gap-2">
        {project && (
          <button
            onClick={() => setShowAssetLibrary(true)}
            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Assets
          </button>
        )}

        <button
          onClick={() => setShowProjectDialog(true)}
          className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Projects
        </button>

        {project && (
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className={`px-3 py-2 text-sm rounded-lg transition-colors ${
              isDirty
                ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)]'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            Save
          </button>
        )}
      </div>

      {/* Asset Library Dialog */}
      {showAssetLibrary && (
        <AssetLibrary onClose={() => setShowAssetLibrary(false)} />
      )}
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}
