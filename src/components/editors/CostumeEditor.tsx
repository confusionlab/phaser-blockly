import { useRef } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import type { Costume } from '../../types';

export function CostumeEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const object = scene?.objects.find(o => o.id === selectedObjectId);

  if (!object) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Select an object to edit costumes
      </div>
    );
  }

  // Handle legacy objects without costumes array
  const costumes: Costume[] = object.costumes || [];
  const currentCostumeIndex = object.currentCostumeIndex ?? 0;

  const handleAddCostume = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedSceneId || !selectedObjectId) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;

      // Create a data URL for the image
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const newCostume: Costume = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
          assetId: dataUrl, // Store data URL directly for now
        };

        const updatedCostumes = [...costumes, newCostume];
        updateObject(selectedSceneId, selectedObjectId, {
          costumes: updatedCostumes,
          // If this is the first costume, set it as current
          currentCostumeIndex: costumes.length === 0 ? 0 : currentCostumeIndex,
        });
      };
      reader.readAsDataURL(file);
    }

    // Reset input
    e.target.value = '';
  };

  const handleSelectCostume = (index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;
    updateObject(selectedSceneId, selectedObjectId, { currentCostumeIndex: index });
  };

  const handleDeleteCostume = (index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;
    const updatedCostumes = costumes.filter((_, i) => i !== index);
    const newCurrentIndex = Math.min(currentCostumeIndex, Math.max(0, updatedCostumes.length - 1));
    updateObject(selectedSceneId, selectedObjectId, {
      costumes: updatedCostumes,
      currentCostumeIndex: newCurrentIndex,
    });
  };

  const handleRenameCostume = (index: number, newName: string) => {
    if (!selectedSceneId || !selectedObjectId) return;
    const updatedCostumes = costumes.map((c, i) =>
      i === index ? { ...c, name: newName } : c
    );
    updateObject(selectedSceneId, selectedObjectId, { costumes: updatedCostumes });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">
          Costumes for {object.name}
        </span>
        <button
          onClick={handleAddCostume}
          className="px-3 py-1.5 bg-[var(--color-primary)] text-white text-sm rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          + Add Costume
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Costume List */}
      <div className="flex-1 overflow-y-auto p-4">
        {costumes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-4xl mb-2">🎨</div>
            <p className="text-sm">No costumes yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Add Costume" to upload images</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {costumes.map((costume, index) => (
              <div
                key={costume.id}
                onClick={() => handleSelectCostume(index)}
                className={`relative group cursor-pointer rounded-lg border-2 p-2 transition-colors ${
                  index === currentCostumeIndex
                    ? 'border-[var(--color-primary)] bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Costume thumbnail */}
                <div className="aspect-square bg-gray-100 rounded mb-2 overflow-hidden">
                  <img
                    src={costume.assetId}
                    alt={costume.name}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Costume name */}
                <input
                  type="text"
                  value={costume.name}
                  onChange={(e) => handleRenameCostume(index, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full text-xs text-center bg-transparent border-none focus:outline-none focus:bg-white focus:ring-1 focus:ring-[var(--color-primary)] rounded px-1"
                />

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCostume(index);
                  }}
                  className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                >
                  ×
                </button>

                {/* Index badge */}
                <div className="absolute top-1 left-1 w-5 h-5 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs">
                  {index + 1}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
