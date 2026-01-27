import { useState, useEffect, useRef, useCallback } from 'react';
import { saveAsset, listAssets, deleteAsset } from '../../db/database';
import type { Asset } from '../../types';

interface AssetLibraryProps {
  onClose: () => void;
  onSelect?: (asset: Asset) => void;
  filterType?: 'sprite' | 'background' | 'sound';
}

// Built-in sprite data (base64 encoded simple shapes)
const BUILTIN_SPRITES: Array<{ id: string; name: string; color: string; shape: 'circle' | 'square' | 'triangle' | 'star' }> = [
  { id: 'builtin-red-circle', name: 'Red Circle', color: '#ef4444', shape: 'circle' },
  { id: 'builtin-blue-circle', name: 'Blue Circle', color: '#3b82f6', shape: 'circle' },
  { id: 'builtin-green-circle', name: 'Green Circle', color: '#22c55e', shape: 'circle' },
  { id: 'builtin-yellow-circle', name: 'Yellow Circle', color: '#eab308', shape: 'circle' },
  { id: 'builtin-red-square', name: 'Red Square', color: '#ef4444', shape: 'square' },
  { id: 'builtin-blue-square', name: 'Blue Square', color: '#3b82f6', shape: 'square' },
  { id: 'builtin-green-square', name: 'Green Square', color: '#22c55e', shape: 'square' },
  { id: 'builtin-yellow-square', name: 'Yellow Square', color: '#eab308', shape: 'square' },
  { id: 'builtin-red-triangle', name: 'Red Triangle', color: '#ef4444', shape: 'triangle' },
  { id: 'builtin-blue-triangle', name: 'Blue Triangle', color: '#3b82f6', shape: 'triangle' },
  { id: 'builtin-purple-star', name: 'Purple Star', color: '#a855f7', shape: 'star' },
  { id: 'builtin-gold-star', name: 'Gold Star', color: '#f59e0b', shape: 'star' },
];

export function AssetLibrary({ onClose, onSelect, filterType }: AssetLibraryProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'builtin' | 'uploaded'>('builtin');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listAssets(filterType);
      setAssets(items);
    } catch (e) {
      console.error('Failed to load assets:', e);
    }
    setLoading(false);
  }, [filterType]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      try {
        // Determine asset type
        let type: Asset['type'] = 'sprite';
        if (file.type.startsWith('audio/')) {
          type = 'sound';
        } else if (file.name.toLowerCase().includes('background') || file.name.toLowerCase().includes('bg')) {
          type = 'background';
        }

        // Create thumbnail for images
        let thumbnail: string | undefined;
        if (file.type.startsWith('image/')) {
          thumbnail = await createThumbnail(file);
        }

        const asset: Asset = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ''),
          type,
          data: file,
          thumbnail,
        };

        await saveAsset(asset);
      } catch (e) {
        console.error('Failed to upload asset:', e);
      }
    }

    loadAssets();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const createThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 64;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d')!;

          // Scale to fit
          const scale = Math.min(size / img.width, size / img.height);
          const x = (size - img.width * scale) / 2;
          const y = (size - img.height * scale) / 2;
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this asset?')) return;

    try {
      await deleteAsset(id);
      setAssets(prev => prev.filter(a => a.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      console.error('Failed to delete asset:', e);
    }
  };

  const handleSelect = () => {
    if (!selectedId) return;

    if (selectedId.startsWith('builtin-')) {
      // Create a virtual asset for built-in sprites
      const builtin = BUILTIN_SPRITES.find(s => s.id === selectedId);
      if (builtin && onSelect) {
        // Generate SVG blob for the shape
        const svg = generateShapeSVG(builtin.shape, builtin.color);
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const asset: Asset = {
          id: builtin.id,
          name: builtin.name,
          type: 'sprite',
          data: blob,
        };
        onSelect(asset);
      }
    } else {
      const asset = assets.find(a => a.id === selectedId);
      if (asset && onSelect) {
        onSelect(asset);
      }
    }
    onClose();
  };

  const generateShapeSVG = (shape: string, color: string): string => {
    const size = 64;
    let path = '';

    switch (shape) {
      case 'circle':
        path = `<circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}" stroke="#333" stroke-width="2"/>`;
        break;
      case 'square':
        path = `<rect x="2" y="2" width="${size-4}" height="${size-4}" rx="4" fill="${color}" stroke="#333" stroke-width="2"/>`;
        break;
      case 'triangle':
        path = `<polygon points="${size/2},4 ${size-4},${size-4} 4,${size-4}" fill="${color}" stroke="#333" stroke-width="2"/>`;
        break;
      case 'star': {
        const cx = size / 2;
        const cy = size / 2;
        const outerR = size / 2 - 4;
        const innerR = outerR * 0.4;
        const points = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (Math.PI / 2) + (i * Math.PI / 5);
          points.push(`${cx + r * Math.cos(angle)},${cy - r * Math.sin(angle)}`);
        }
        path = `<polygon points="${points.join(' ')}" fill="${color}" stroke="#333" stroke-width="2"/>`;
        break;
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${path}</svg>`;
  };

  const renderBuiltinSprite = (sprite: typeof BUILTIN_SPRITES[0]) => {
    const svgContent = generateShapeSVG(sprite.shape, sprite.color);
    return (
      <div
        key={sprite.id}
        onClick={() => setSelectedId(sprite.id)}
        className={`relative group p-2 rounded-lg border-2 cursor-pointer transition-all ${
          selectedId === sprite.id
            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div
          className="w-12 h-12 mx-auto"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
        <p className="text-xs text-center text-gray-600 mt-1 truncate">
          {sprite.name}
        </p>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Asset Library</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <CloseIcon />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setTab('builtin')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === 'builtin'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Built-in Sprites
            </button>
            <button
              onClick={() => setTab('uploaded')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === 'uploaded'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              My Assets ({assets.length})
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'builtin' ? (
            <div className="grid grid-cols-6 gap-3">
              {BUILTIN_SPRITES.map(renderBuiltinSprite)}
            </div>
          ) : loading ? (
            <div className="text-center text-gray-500 py-8">Loading...</div>
          ) : assets.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <p className="mb-4">No uploaded assets yet</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary)]/90 transition-colors"
              >
                Upload Files
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {assets.map(asset => (
                <div
                  key={asset.id}
                  onClick={() => setSelectedId(asset.id)}
                  className={`relative group p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedId === asset.id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Thumbnail */}
                  {asset.thumbnail ? (
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-full aspect-square object-contain rounded"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-gray-100 rounded flex items-center justify-center">
                      {asset.type === 'sound' ? '🔊' : '🖼️'}
                    </div>
                  )}

                  {/* Name */}
                  <p className="text-sm text-center text-gray-700 truncate mt-2">
                    {asset.name}
                  </p>

                  {/* Type badge */}
                  <span className={`absolute top-2 left-2 px-2 py-0.5 text-xs rounded-full ${
                    asset.type === 'sprite' ? 'bg-blue-100 text-blue-600' :
                    asset.type === 'sound' ? 'bg-pink-100 text-pink-600' :
                    'bg-green-100 text-green-600'
                  }`}>
                    {asset.type}
                  </span>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(asset.id);
                    }}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-100 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,audio/*"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            {tab === 'uploaded' && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Upload Files
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            {onSelect && (
              <button
                onClick={handleSelect}
                disabled={!selectedId}
                className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Select
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
