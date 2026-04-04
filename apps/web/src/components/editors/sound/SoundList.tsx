import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useConvex, useConvexAuth, useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { MenuItemButton, MenuSeparator } from '@/components/ui/menu-item-button';
import { SoundLibraryBrowser } from '@/components/dialogs/SoundLibraryBrowser';
import { AssetSidebar } from '@/components/editors/shared/AssetSidebar';
import { AssetSidebarTile } from '@/components/editors/shared/AssetSidebarTile';
import { useAssetSidebarDrag } from '@/components/editors/shared/useAssetSidebarDrag';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import type { Sound } from '@/types';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import { Library, Loader2, Mic, Trash2, Upload, Volume2, Copy, CopyPlus, Clipboard, Scissors } from '@/components/ui/icons';
import { prepareSoundLibraryCreatePayload } from '@/lib/soundLibrary/soundLibraryAssets';
import { ensureLibraryAssetRefsInCloud } from '@/lib/templateLibrary/libraryAssetRefs';
import { useModal } from '@/components/ui/modal-provider';
import {
  getAssetCardActionIds,
  getAssetCardClipboard,
  hasAssetCardClipboardContents,
  insertAssetItemsAtIndex,
  setAssetCardClipboard,
  type AssetCardClipboardMode,
} from '@/lib/editor/assetCardClipboard';

interface SoundListProps {
  sounds: Sound[];
  activeSoundId: string | null;
  selectedSoundIds: string[];
  onOpenRecorder: () => void;
  onSelectSound: (
    soundId: string,
    event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  ) => void;
  onAddSound: (sound: Sound) => void;
  onDeleteSounds: (soundIds: string[]) => void;
  onRenameSound: (soundId: string, name: string) => void;
  onReplaceSounds: (nextSounds: Sound[], nextActiveSoundId: string | null, nextSelectedSoundIds: string[]) => void;
  onPrepareSoundDrag: (soundId: string) => string[];
  onReorderSounds: (soundIds: string[], targetIndex: number) => void;
}

export const SoundList = memo(({
  sounds,
  activeSoundId,
  selectedSoundIds,
  onOpenRecorder,
  onSelectSound,
  onAddSound,
  onDeleteSounds,
  onRenameSound,
  onReplaceSounds,
  onPrepareSoundDrag,
  onReorderSounds,
}: SoundListProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ soundId: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const selectedSoundIdSet = new Set(selectedSoundIds);
  const { showAlert } = useModal();

  const generateUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const createLibraryItem = useMutation(api.soundLibrary.create);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalKeyboardEvent(event)) {
        return;
      }

      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    if (!contextMenu || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      handleCloseContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [contextMenu]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setIsProcessing(true);

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/')) {
          continue;
        }

        try {
          const originalDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const compressedDataUrl = await compressAudio(originalDataUrl);
          const duration = await getAudioDuration(compressedDataUrl);

          onAddSound({
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^/.]+$/, ''),
            assetId: compressedDataUrl,
            duration,
          });
        } catch (error) {
          console.error('Failed to process audio:', file.name, error);
        }
      }
    } finally {
      setIsProcessing(false);
      event.target.value = '';
    }
  };

  const handleLibrarySelect = async (data: { name: string; dataUrl: string }) => {
    try {
      const duration = await getAudioDuration(data.dataUrl);
      onAddSound({
        id: crypto.randomUUID(),
        name: data.name,
        assetId: data.dataUrl,
        duration,
      });
    } catch (error) {
      console.error('Failed to add sound from library:', error);
      await showAlert({
        title: 'Add Failed',
        description: 'Failed to add sound from library',
        tone: 'destructive',
      });
    }
  };

  const handleSaveToLibrary = async (index: number) => {
    if (!isAuthenticated) {
      await showAlert({
        title: 'Sign In Required',
        description: 'Sign in to save sounds to the cloud library.',
      });
      return;
    }

    const sound = sounds[index];
    if (!sound) {
      return;
    }

    setSavingToLibrary(index);
    try {
      const prepared = await prepareSoundLibraryCreatePayload(sound);
      await ensureLibraryAssetRefsInCloud(prepared.assetRefs, {
        listMissingAssetIds: async (assetIds) => {
          return await convex.query(api.projectAssets.listMissing, { assetIds }) as string[];
        },
        generateUploadUrl,
        upsertAsset: async (args) => {
          return await upsertProjectAsset({
            assetId: args.assetId,
            kind: args.kind,
            mimeType: args.mimeType,
            size: args.size,
            storageId: args.storageId,
          });
        },
      });

      await createLibraryItem(prepared.payload);
    } catch (error) {
      console.error('Failed to save sound to library:', error);
      await showAlert({
        title: 'Save Failed',
        description: 'Failed to save sound to library',
        tone: 'destructive',
      });
    } finally {
      setSavingToLibrary(null);
    }
  };

  const handleCloseContextMenu = () => setContextMenu(null);
  const contextMenuSound = contextMenu
    ? sounds.find((sound) => sound.id === contextMenu.soundId) ?? null
    : null;
  const contextMenuSoundIndex = contextMenuSound
    ? sounds.findIndex((sound) => sound.id === contextMenuSound.id)
    : -1;
  const contextMenuDeleteIds = contextMenuSound
    ? (selectedSoundIds.length > 1 && selectedSoundIdSet.has(contextMenuSound.id)
        ? selectedSoundIds
        : [contextMenuSound.id])
    : [];
  const contextMenuDeleteLabel = contextMenuDeleteIds.length > 1
    ? `Delete Selected (${contextMenuDeleteIds.length})`
    : 'Delete';
  const getContextMenuActionIds = useCallback(() => {
    return getAssetCardActionIds(
      sounds.map((sound) => sound.id),
      selectedSoundIds,
      contextMenuSound?.id ?? null,
    );
  }, [contextMenuSound?.id, selectedSoundIds, sounds]);

  const cloneSoundForPaste = useCallback((sound: Sound, mode: AssetCardClipboardMode): Sound => ({
    ...sound,
    id: crypto.randomUUID(),
    name: mode === 'cut' ? sound.name : `${sound.name} Copy`,
  }), []);

  const handleCopySounds = useCallback((mode: AssetCardClipboardMode = 'copy') => {
    const actionIds = getContextMenuActionIds();
    if (actionIds.length === 0) {
      return false;
    }

    const soundById = new Map(sounds.map((sound) => [sound.id, sound]));
    const entries = actionIds
      .map((id) => soundById.get(id))
      .filter((sound): sound is Sound => !!sound)
      .map((sound) => ({ item: { ...sound } }));

    if (entries.length === 0) {
      return false;
    }

    setAssetCardClipboard({
      kind: 'sound',
      mode,
      entries,
    });
    return true;
  }, [getContextMenuActionIds, sounds]);

  const handleCutSounds = useCallback(() => {
    if (!handleCopySounds('cut')) {
      return;
    }
    onDeleteSounds(contextMenuDeleteIds);
    handleCloseContextMenu();
  }, [contextMenuDeleteIds, handleCopySounds, onDeleteSounds]);

  const handlePasteSounds = useCallback((modeOverride?: AssetCardClipboardMode) => {
    const clipboard = getAssetCardClipboard<Sound>('sound');
    if (!clipboard) {
      return;
    }

    const nextMode = modeOverride ?? clipboard.mode;
    const insertedSounds = clipboard.entries.map((entry) => cloneSoundForPaste(entry.item, nextMode));
    if (insertedSounds.length === 0) {
      return;
    }

    const targetIndex = contextMenuSoundIndex >= 0 ? contextMenuSoundIndex + 1 : sounds.length;
    const nextSounds = insertAssetItemsAtIndex(sounds, insertedSounds, targetIndex);
    const nextSelectedIds = insertedSounds.map((sound) => sound.id);
    onReplaceSounds(nextSounds, nextSelectedIds[0] ?? null, nextSelectedIds);

    if (clipboard.mode === 'cut' && !modeOverride) {
      setAssetCardClipboard({
        kind: 'sound',
        mode: 'copy',
        entries: insertedSounds.map((sound) => ({ item: { ...sound } })),
      });
    }

    handleCloseContextMenu();
  }, [cloneSoundForPaste, contextMenuSoundIndex, onReplaceSounds, sounds]);

  const handleDuplicateSounds = useCallback(() => {
    if (!handleCopySounds('copy')) {
      return;
    }
    handlePasteSounds('copy');
  }, [handleCopySounds, handlePasteSounds]);
  const {
    dropBoundaryRef,
    draggedItemIds: draggedSoundIds,
    dropTarget,
    clearDragState,
    handleDragStart: handleSoundDragStart,
    handleDragOver: handleSoundDragOver,
    handleTailDragOver: handleTailSoundDragOver,
    handleDrop: handleSoundDrop,
    handleTailDrop: handleTailSoundDrop,
  } = useAssetSidebarDrag({
    itemIds: sounds.map((sound) => sound.id),
    dataTransferType: 'application/x-pocha-sound-ids',
    onPrepareDrag: onPrepareSoundDrag,
    onReorder: onReorderSounds,
  });

  return (
    <>
      <AssetSidebar
        actions={
          <>
            <IconButton
              label="Record sound"
              onClick={onOpenRecorder}
              disabled={isProcessing}
              size="xs"
            >
              <Mic className="size-3.5" />
            </IconButton>
            <IconButton
              label="Import sound"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              size="xs"
            >
              {isProcessing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            </IconButton>
            <IconButton
              label="Browse library"
              onClick={() => setShowLibrary(true)}
              disabled={isProcessing}
              size="xs"
            >
              <Library className="size-3.5" />
            </IconButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        }
      >
        <div ref={dropBoundaryRef}>
          {sounds.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-2 text-center text-muted-foreground">
              <Volume2 className="size-8" />
              <p className="mt-2 text-xs">No sounds</p>
            </div>
          ) : (
            <>
              {sounds.map((sound, index) => {
                const isSelected = selectedSoundIdSet.has(sound.id);
                const isActive = sound.id === activeSoundId;

                return (
                  <div
                    key={sound.id}
                    className="relative py-1 first:pt-0"
                    onDragOver={(event) => handleSoundDragOver(event, index)}
                    onDrop={(event) => handleSoundDrop(event, index)}
                  >
                    {dropTarget?.key === sound.id && dropTarget.dropPosition === 'before' ? (
                      <div className="pointer-events-none absolute inset-x-1 top-0 z-10 h-0 border-t-2 border-primary" />
                    ) : null}
                    <AssetSidebarTile
                      itemId={sound.id}
                      index={index}
                      name={sound.name}
                      selected={isSelected}
                      active={isActive}
                      testId="sound-list-tile"
                      dragging={draggedSoundIds.includes(sound.id)}
                      draggable
                      onClick={(event) => onSelectSound(sound.id, event)}
                      onActivate={() => onSelectSound(sound.id, { metaKey: false, ctrlKey: false, shiftKey: false })}
                      onNameCommit={(name) => onRenameSound(sound.id, name)}
                      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
                        event.preventDefault();
                        setContextMenu({
                          soundId: sound.id,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      onDragStart={(event) => handleSoundDragStart(event, sound.id)}
                      onDragEnd={clearDragState}
                      media={
                        <div className="flex h-full items-center justify-center">
                          <Volume2 className="size-8 text-muted-foreground" />
                        </div>
                      }
                    />
                    {dropTarget?.key === sound.id && dropTarget.dropPosition === 'after' ? (
                      <div className="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0 border-t-2 border-primary" />
                    ) : null}
                  </div>
                );
              })}
              <div
                className="relative h-3"
                onDragOver={handleTailSoundDragOver}
                onDrop={handleTailSoundDrop}
              >
                {dropTarget?.key === null && dropTarget.dropPosition === null ? (
                  <div className="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0 border-t-2 border-primary" />
                ) : null}
              </div>
            </>
          )}
        </div>
      </AssetSidebar>

      {contextMenu ? (
        <>
          <Card
            ref={contextMenuRef}
            className="fixed z-50 min-w-44 gap-0 py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <MenuItemButton
              icon={<Copy className="size-4" />}
              onClick={() => {
                handleCopySounds('copy');
                handleCloseContextMenu();
              }}
            >
              Copy
            </MenuItemButton>
            <MenuItemButton
              icon={<Scissors className="size-4" />}
              onClick={handleCutSounds}
            >
              Cut
            </MenuItemButton>
            {hasAssetCardClipboardContents('sound') ? (
              <MenuItemButton
                icon={<Clipboard className="size-4" />}
                onClick={() => handlePasteSounds()}
              >
                Paste
              </MenuItemButton>
            ) : null}
            <MenuItemButton
              icon={<CopyPlus className="size-4" />}
              onClick={handleDuplicateSounds}
            >
              Duplicate
            </MenuItemButton>
            <MenuSeparator />
            <MenuItemButton
              icon={contextMenuSound && savingToLibrary === contextMenuSoundIndex ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Library className="size-4" />
              )}
              onClick={() => {
                if (contextMenuSound) {
                  void handleSaveToLibrary(contextMenuSoundIndex);
                }
                handleCloseContextMenu();
              }}
              disabled={!isAuthenticated || !contextMenuSound || contextMenuSoundIndex < 0 || savingToLibrary === contextMenuSoundIndex}
            >
              Add to Library
            </MenuItemButton>
            <MenuItemButton
              icon={<Trash2 className="size-4" />}
              intent="destructive"
              onClick={() => {
                onDeleteSounds(contextMenuDeleteIds);
                handleCloseContextMenu();
              }}
            >
              {contextMenuDeleteLabel}
            </MenuItemButton>
          </Card>
        </>
      ) : null}

      <SoundLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </>
  );
});

SoundList.displayName = 'SoundList';
