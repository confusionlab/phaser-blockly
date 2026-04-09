import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { MenuItemButton, MenuSeparator } from '@/components/ui/menu-item-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Copy, Eye, EyeOff, Image, Lock, LockOpen, Minus, Plus, Shapes, Trash2 } from '@/components/ui/icons';
import { EDITOR_POPOVER_Z_INDEX } from '@/components/editors/shared/editorChromeZIndices';
import { MAX_ANIMATED_COSTUME_FPS, MAX_COSTUME_LAYERS } from '@/lib/costume/costumeDocument';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { cn } from '@/lib/utils';
import type { AnimatedCostumeCel, AnimatedCostumeClip } from '@/types';

const MAX_CONTEXT_MENU_MARGIN = 12;
const TIMELINE_FRAME_WIDTH = 32;
const TIMELINE_TRACK_HEADER_WIDTH = 260;
const TIMELINE_SECTION_GAP = 12;
const TIMELINE_CELL_HORIZONTAL_INSET = 2;

type TrackContextMenuState = {
  trackId: string;
  x: number;
  y: number;
};

type CelContextMenuState = {
  trackId: string;
  celId: string;
  x: number;
  y: number;
};

type CelInteractionState = {
  trackId: string;
  celId: string;
  mode: 'move' | 'resize-start' | 'resize-end';
  initialClientX: number;
  initialStartFrame: number;
  initialDurationFrames: number;
  minStartFrame: number;
  maxStartFrame: number;
  minEndFrame: number;
  maxEndFrame: number;
  previewStartFrame: number;
  previewDurationFrames: number;
};

type FrameHeaderScrubState = {
  active: boolean;
};

interface AnimatedCostumeTimelineProps {
  clip: AnimatedCostumeClip;
  currentFrameIndex: number;
  onFrameSelect: (frameIndex: number) => void;
  onChangeTotalFrames: (totalFrames: number) => void;
  onChangeFps: (fps: number) => void;
  onChangePlayback: (playback: AnimatedCostumeClip['playback']) => void;
  onSelectTrack: (trackId: string) => void;
  onAddBitmapTrack: () => void;
  onAddVectorTrack: () => void;
  onDuplicateTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onReorderTrack: (trackId: string, targetIndex: number) => void;
  onToggleVisibility: (trackId: string) => void;
  onToggleLocked: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onOpacityChange: (trackId: string, opacity: number) => void;
  onUpdateCelSpan: (trackId: string, celId: string, startFrame: number, durationFrames: number) => void;
  onDeleteCel: (trackId: string, celId: string) => void;
}

function clampOpacityPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampFrame(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function TrackKindIcon({ kind }: { kind: AnimatedCostumeClip['tracks'][number]['kind'] }) {
  return kind === 'bitmap'
    ? <Image className="size-3.5" />
    : <Shapes className="size-3.5" />;
}

function resolveContextMenuPosition(
  position: { left: number; top: number } | null,
  rect: DOMRect | null,
): { left: number; top: number } | null {
  if (!position || !rect) {
    return position;
  }

  let nextLeft = position.left;
  let nextTop = position.top;

  if (nextLeft + rect.width > window.innerWidth - MAX_CONTEXT_MENU_MARGIN) {
    nextLeft = Math.max(MAX_CONTEXT_MENU_MARGIN, window.innerWidth - rect.width - MAX_CONTEXT_MENU_MARGIN);
  }
  if (nextTop + rect.height > window.innerHeight - MAX_CONTEXT_MENU_MARGIN) {
    nextTop = Math.max(MAX_CONTEXT_MENU_MARGIN, window.innerHeight - rect.height - MAX_CONTEXT_MENU_MARGIN);
  }
  if (nextLeft < MAX_CONTEXT_MENU_MARGIN) {
    nextLeft = MAX_CONTEXT_MENU_MARGIN;
  }
  if (nextTop < MAX_CONTEXT_MENU_MARGIN) {
    nextTop = MAX_CONTEXT_MENU_MARGIN;
  }

  return {
    left: nextLeft,
    top: nextTop,
  };
}

function getDisplayedCelSpan(
  cel: AnimatedCostumeCel,
  interaction: CelInteractionState | null,
): { startFrame: number; durationFrames: number } {
  if (!interaction || interaction.celId !== cel.id) {
    return {
      startFrame: cel.startFrame,
      durationFrames: cel.durationFrames,
    };
  }

  return {
    startFrame: interaction.previewStartFrame,
    durationFrames: interaction.previewDurationFrames,
  };
}

function getFrameIndexFromCelPointer(
  event: ReactMouseEvent<HTMLDivElement>,
  cel: AnimatedCostumeCel,
): number {
  const eventTarget = event.target;
  const celElement = eventTarget instanceof HTMLElement
    ? eventTarget.closest<HTMLElement>('[data-animated-cel="true"]')
    : null;
  const rect = celElement?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) {
    return cel.startFrame;
  }

  const frameWidth = rect.width / Math.max(cel.durationFrames, 1);
  const frameOffset = clampFrame(
    Math.floor((event.clientX - rect.left) / Math.max(frameWidth, 1)),
    0,
    Math.max(cel.durationFrames - 1, 0),
  );
  return cel.startFrame + frameOffset;
}

export function AnimatedCostumeTimeline({
  clip,
  currentFrameIndex,
  onFrameSelect,
  onChangeTotalFrames,
  onChangeFps,
  onChangePlayback,
  onSelectTrack,
  onAddBitmapTrack,
  onAddVectorTrack,
  onDuplicateTrack,
  onDeleteTrack,
  onReorderTrack,
  onToggleVisibility,
  onToggleLocked,
  onRenameTrack,
  onOpacityChange,
  onUpdateCelSpan,
  onDeleteCel,
}: AnimatedCostumeTimelineProps) {
  const canAddTrack = clip.tracks.length < MAX_COSTUME_LAYERS;
  const maxTrackTooltip = `Max layer, max ${MAX_COSTUME_LAYERS} layers`;
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenuState | null>(null);
  const [trackContextMenuPosition, setTrackContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [trackContextMenuOpacityDraft, setTrackContextMenuOpacityDraft] = useState(100);
  const [celContextMenu, setCelContextMenu] = useState<CelContextMenuState | null>(null);
  const [celContextMenuPosition, setCelContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [celInteraction, setCelInteraction] = useState<CelInteractionState | null>(null);
  const [frameHeaderScrub, setFrameHeaderScrub] = useState<FrameHeaderScrubState | null>(null);
  const trackContextMenuRef = useRef<HTMLDivElement | null>(null);
  const celContextMenuRef = useRef<HTMLDivElement | null>(null);
  const frameHeaderStripRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const previousTotalFramesRef = useRef(clip.totalFrames);

  const trackContextMenuTrack = useMemo(() => (
    trackContextMenu ? clip.tracks.find((track) => track.id === trackContextMenu.trackId) ?? null : null
  ), [clip.tracks, trackContextMenu]);

  const celContextMenuTrack = useMemo(() => (
    celContextMenu ? clip.tracks.find((track) => track.id === celContextMenu.trackId) ?? null : null
  ), [clip.tracks, celContextMenu]);

  const celContextMenuCel = useMemo(() => (
    celContextMenuTrack && celContextMenu
      ? celContextMenuTrack.cels.find((cel) => cel.id === celContextMenu.celId) ?? null
      : null
  ), [celContextMenu, celContextMenuTrack]);
  const canRemoveTrailingFrame = useMemo(() => {
    if (clip.totalFrames <= 1) {
      return false;
    }

    const lastFrameIndex = clip.totalFrames - 1;
    const lastFrameIsOccupied = clip.tracks.some((track) => track.cels.some((cel) => (
      lastFrameIndex >= cel.startFrame &&
      lastFrameIndex < cel.startFrame + cel.durationFrames
    )));
    return !lastFrameIsOccupied;
  }, [clip.totalFrames, clip.tracks]);
  const removeTrailingFrameTooltip = clip.totalFrames <= 1
    ? 'At least one frame is required'
    : 'Clear the last frame before removing it';

  useEffect(() => {
    if (editingTrackId && !clip.tracks.some((track) => track.id === editingTrackId)) {
      setEditingTrackId(null);
      setRenameDraft('');
    }
  }, [clip.tracks, editingTrackId]);

  const autoSelectedCelId = useMemo(() => {
    const activeTrack = clip.tracks.find((track) => track.id === clip.activeTrackId);
    if (!activeTrack) {
      return null;
    }

    const selectedCel = activeTrack.cels.find((cel) => (
      currentFrameIndex >= cel.startFrame &&
      currentFrameIndex < cel.startFrame + cel.durationFrames
    ));
    return selectedCel?.id ?? null;
  }, [clip.activeTrackId, clip.tracks, currentFrameIndex]);

  useEffect(() => {
    if (!trackContextMenuTrack || !trackContextMenu) {
      setTrackContextMenuPosition(null);
      return;
    }

    setTrackContextMenuPosition({ left: trackContextMenu.x, top: trackContextMenu.y });
    setTrackContextMenuOpacityDraft(clampOpacityPercent(trackContextMenuTrack.opacity * 100));
  }, [trackContextMenu, trackContextMenuTrack]);

  useEffect(() => {
    if (!trackContextMenu || !trackContextMenuRef.current || !trackContextMenuPosition) {
      return;
    }

    const nextPosition = resolveContextMenuPosition(
      trackContextMenuPosition,
      trackContextMenuRef.current.getBoundingClientRect(),
    );
    if (
      nextPosition &&
      (nextPosition.left !== trackContextMenuPosition.left || nextPosition.top !== trackContextMenuPosition.top)
    ) {
      setTrackContextMenuPosition(nextPosition);
    }
  }, [trackContextMenu, trackContextMenuPosition]);

  useEffect(() => {
    if (!celContextMenu || !celContextMenuRef.current || !celContextMenuPosition) {
      return;
    }

    const nextPosition = resolveContextMenuPosition(
      celContextMenuPosition,
      celContextMenuRef.current.getBoundingClientRect(),
    );
    if (
      nextPosition &&
      (nextPosition.left !== celContextMenuPosition.left || nextPosition.top !== celContextMenuPosition.top)
    ) {
      setCelContextMenuPosition(nextPosition);
    }
  }, [celContextMenu, celContextMenuPosition]);

  useEffect(() => {
    if (!celContextMenu) {
      setCelContextMenuPosition(null);
      return;
    }

    setCelContextMenuPosition({ left: celContextMenu.x, top: celContextMenu.y });
  }, [celContextMenu]);

  useEffect(() => {
    if (!trackContextMenu && !celContextMenu) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTrackContextMenu(null);
        setCelContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [celContextMenu, trackContextMenu]);

  useEffect(() => {
    if (!celInteraction) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const deltaFrames = Math.round((event.clientX - celInteraction.initialClientX) / TIMELINE_FRAME_WIDTH);
      setCelInteraction((current) => {
        if (!current) {
          return current;
        }

        if (current.mode === 'move') {
          const nextStartFrame = clampFrame(
            current.initialStartFrame + deltaFrames,
            current.minStartFrame,
            current.maxStartFrame,
          );
          return {
            ...current,
            previewStartFrame: nextStartFrame,
            previewDurationFrames: current.initialDurationFrames,
          };
        }

        if (current.mode === 'resize-start') {
          const nextStartFrame = clampFrame(
            current.initialStartFrame + deltaFrames,
            current.minStartFrame,
            current.maxStartFrame,
          );
          return {
            ...current,
            previewStartFrame: nextStartFrame,
            previewDurationFrames: current.initialStartFrame + current.initialDurationFrames - nextStartFrame,
          };
        }

        const currentEndFrame = current.initialStartFrame + current.initialDurationFrames;
        const nextEndFrame = clampFrame(
          currentEndFrame + deltaFrames,
          current.minEndFrame,
          current.maxEndFrame,
        );
        return {
          ...current,
          previewStartFrame: current.initialStartFrame,
          previewDurationFrames: nextEndFrame - current.initialStartFrame,
        };
      });
    };

    const handleMouseUp = () => {
      setCelInteraction((current) => {
        if (!current) {
          return current;
        }

        if (
          current.previewStartFrame !== current.initialStartFrame ||
          current.previewDurationFrames !== current.initialDurationFrames
        ) {
          onUpdateCelSpan(
            current.trackId,
            current.celId,
            current.previewStartFrame,
            current.previewDurationFrames,
          );
        }
        return null;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [celInteraction, onUpdateCelSpan]);

  useEffect(() => {
    if (!frameHeaderScrub?.active) {
      return;
    }

    const selectFrameFromClientX = (clientX: number) => {
      const strip = frameHeaderStripRef.current;
      if (!strip) {
        return;
      }

      const rect = strip.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const frameIndex = clampFrame(
        Math.floor(relativeX / TIMELINE_FRAME_WIDTH),
        0,
        Math.max(clip.totalFrames - 1, 0),
      );
      onFrameSelect(frameIndex);
    };

    const handleMouseMove = (event: MouseEvent) => {
      selectFrameFromClientX(event.clientX);
    };

    const handleMouseUp = () => {
      setFrameHeaderScrub(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [clip.totalFrames, frameHeaderScrub, onFrameSelect]);

  useEffect(() => {
    const previousTotalFrames = previousTotalFramesRef.current;
    previousTotalFramesRef.current = clip.totalFrames;

    if (clip.totalFrames <= previousTotalFrames) {
      return;
    }

    const scrollContainer = timelineScrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollContainer.scrollLeft = scrollContainer.scrollWidth;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [clip.totalFrames]);

  const closeTrackContextMenu = () => {
    setTrackContextMenu(null);
  };

  const closeCelContextMenu = () => {
    setCelContextMenu(null);
  };

  const startInlineRename = (trackId: string, currentName: string) => {
    onSelectTrack(trackId);
    setEditingTrackId(trackId);
    setRenameDraft(currentName);
  };

  const commitInlineRename = (trackId: string) => {
    const track = clip.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
      setEditingTrackId(null);
      setRenameDraft('');
      return;
    }

    if (renameDraft !== track.name) {
      onRenameTrack(trackId, renameDraft);
    }

    setEditingTrackId(null);
    setRenameDraft('');
  };

  const cancelInlineRename = () => {
    setEditingTrackId(null);
    setRenameDraft('');
  };

  const commitTrackContextMenuOpacity = (nextDraft = trackContextMenuOpacityDraft) => {
    if (!trackContextMenuTrack) {
      return;
    }

    const clampedDraft = clampOpacityPercent(nextDraft);
    if (clampedDraft !== trackContextMenuOpacityDraft) {
      setTrackContextMenuOpacityDraft(clampedDraft);
    }

    if (clampOpacityPercent(trackContextMenuTrack.opacity * 100) === clampedDraft) {
      return;
    }

    onOpacityChange(trackContextMenuTrack.id, clampedDraft / 100);
  };

  const clearTrackDragState = () => {
    setDraggedTrackId(null);
    setDropIndicatorIndex(null);
  };

  const handleTrackDragStart = (event: ReactDragEvent<HTMLDivElement>, trackId: string) => {
    setDraggedTrackId(trackId);
    setDropIndicatorIndex(null);
    onSelectTrack(trackId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', trackId);
  };

  const handleTrackDragOver = (event: ReactDragEvent<HTMLDivElement>, displayIndex: number) => {
    if (!draggedTrackId) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    setDropIndicatorIndex(before ? displayIndex : displayIndex + 1);
    event.dataTransfer.dropEffect = 'move';
  };

  const handleTrackDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourceTrackId = draggedTrackId ?? event.dataTransfer.getData('text/plain');
    if (!sourceTrackId || dropIndicatorIndex === null) {
      clearTrackDragState();
      return;
    }

    const sourceDisplayIndex = clip.tracks.findIndex((track) => track.id === sourceTrackId);
    if (sourceDisplayIndex < 0) {
      clearTrackDragState();
      return;
    }

    const finalDisplayIndex = dropIndicatorIndex > sourceDisplayIndex
      ? dropIndicatorIndex - 1
      : dropIndicatorIndex;
    const targetIndex = Math.max(0, Math.min(finalDisplayIndex, clip.tracks.length - 1));

    if (targetIndex !== sourceDisplayIndex) {
      onReorderTrack(sourceTrackId, targetIndex);
    }

    clearTrackDragState();
  };

  const handleTrackKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, trackId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectTrack(trackId);
    }
  };

  const handleTrackContextMenu = (event: ReactMouseEvent<HTMLDivElement>, trackId: string) => {
    event.preventDefault();
    onSelectTrack(trackId);
    setCelContextMenu(null);
    setTrackContextMenu({
      trackId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const beginCelInteraction = (
    event: ReactMouseEvent<HTMLDivElement>,
    trackId: string,
    cel: AnimatedCostumeCel,
    mode: CelInteractionState['mode'],
    previousEndFrame: number,
    nextStartFrame: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setTrackContextMenu(null);
    setCelContextMenu(null);
    onSelectTrack(trackId);
    onFrameSelect(getFrameIndexFromCelPointer(event, cel));

    setCelInteraction({
      trackId,
      celId: cel.id,
      mode,
      initialClientX: event.clientX,
      initialStartFrame: cel.startFrame,
      initialDurationFrames: cel.durationFrames,
      minStartFrame: previousEndFrame,
      maxStartFrame: mode === 'move'
        ? Math.max(previousEndFrame, nextStartFrame - cel.durationFrames)
        : Math.max(previousEndFrame, cel.startFrame + cel.durationFrames - 1),
      minEndFrame: cel.startFrame + 1,
      maxEndFrame: nextStartFrame,
      previewStartFrame: cel.startFrame,
      previewDurationFrames: cel.durationFrames,
    });
  };

  const handleCelContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    trackId: string,
    celId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectTrack(trackId);
    setTrackContextMenu(null);
    setCelContextMenu({
      trackId,
      celId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const beginFrameHeaderScrub = (event: ReactMouseEvent<HTMLDivElement>) => {
    const strip = frameHeaderStripRef.current;
    if (!strip) {
      return;
    }

    event.preventDefault();
    const rect = strip.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const frameIndex = clampFrame(
      Math.floor(relativeX / TIMELINE_FRAME_WIDTH),
      0,
      Math.max(clip.totalFrames - 1, 0),
    );
    onFrameSelect(frameIndex);
    setFrameHeaderScrub({ active: true });
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col border-t border-border/70 bg-background/95">
        <div ref={timelineScrollContainerRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
          <div className="relative min-h-full min-w-max overflow-visible">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 z-0"
              style={{
                left: TIMELINE_TRACK_HEADER_WIDTH + TIMELINE_SECTION_GAP,
                width: clip.totalFrames * TIMELINE_FRAME_WIDTH,
              }}
            >
              {[0, ...Array.from(
                { length: Math.max(0, clip.totalFrames - 1) },
                (_, separatorIndex) => ((separatorIndex + 1) * TIMELINE_FRAME_WIDTH) - 0.5,
              ), (clip.totalFrames * TIMELINE_FRAME_WIDTH) - 0.5].map((separatorLeft, separatorIndex) => (
                <div
                  key={`frame-separator-${separatorIndex}`}
                  className="absolute top-0 bottom-0 w-px bg-border/45"
                  style={{
                    left: separatorLeft,
                  }}
                />
              ))}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-10 rounded-sm border-x border-primary/35 bg-primary/10"
              style={{
                left: TIMELINE_TRACK_HEADER_WIDTH + TIMELINE_SECTION_GAP + (currentFrameIndex * TIMELINE_FRAME_WIDTH),
                top: 4,
                bottom: 4,
                width: TIMELINE_FRAME_WIDTH,
              }}
            />
            <div className="relative z-10 mb-2 flex items-center gap-3">
              <div className="relative" style={{ width: TIMELINE_TRACK_HEADER_WIDTH }} >
                <div className="flex h-8 items-center justify-between gap-2">
                  <div className="relative flex items-center group/track-add">
                    {canAddTrack ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            className="rounded-[12px] border border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-surface-interactive hover:text-foreground"
                            label="Add track"
                            size="sm"
                          >
                            <Plus className="size-3.5" />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="start" sideOffset={8} className="min-w-36 rounded-xl">
                          <DropdownMenuItem onClick={onAddVectorTrack}>
                            <Shapes className="size-4" />
                            Vector
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={onAddBitmapTrack}>
                            <Image className="size-4" />
                            Pixel
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <>
                        <IconButton
                          disabled
                          className="rounded-[12px] border border-transparent bg-transparent text-muted-foreground shadow-none disabled:opacity-50 group-hover/track-add:bg-surface-interactive"
                          label="Add track"
                          size="sm"
                          title={maxTrackTooltip}
                        >
                          <Plus className="size-3.5" />
                        </IconButton>
                        <div
                          role="tooltip"
                          className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 min-w-max -translate-y-1/2 rounded-xl border border-border/70 bg-surface-floating px-3 py-2 text-xs text-foreground opacity-0 shadow-[0_18px_42px_-26px_rgba(15,23,42,0.55)] transition-opacity group-hover/track-add:opacity-100"
                        >
                          {maxTrackTooltip}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">FPS</span>
                      <input
                        type="number"
                        min={1}
                        max={MAX_ANIMATED_COSTUME_FPS}
                        inputMode="numeric"
                        value={clip.fps}
                        onChange={(event) => onChangeFps(Number(event.target.value))}
                        className="h-7 w-11 rounded border border-input bg-background px-1.5 text-center text-xs tabular-nums"
                      />
                    </label>

                    <select
                      value={clip.playback}
                      onChange={(event) => onChangePlayback(event.target.value as AnimatedCostumeClip['playback'])}
                      className="h-7 rounded border border-input bg-background px-2 text-xs"
                      aria-label="Playback mode"
                    >
                      <option value="play-once">Play Once</option>
                      <option value="loop">Loop</option>
                      <option value="ping-pong">Ping-Pong</option>
                    </select>
                  </div>
                </div>
              </div>

              <div
                className="relative h-8"
                style={{ width: clip.totalFrames * TIMELINE_FRAME_WIDTH }}
                ref={frameHeaderStripRef}
                onMouseDown={beginFrameHeaderScrub}
              >
                <div className="absolute inset-0 flex">
                  {Array.from({ length: clip.totalFrames }, (_, frameIndex) => (
                  <button
                    key={`frame-header-${frameIndex}`}
                    type="button"
                    onClick={() => {
                      onFrameSelect(frameIndex);
                    }}
                    className="flex h-full items-center justify-center bg-transparent text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    style={{ width: TIMELINE_FRAME_WIDTH }}
                  >
                    {frameIndex + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex h-8 w-7 shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => onChangeTotalFrames(clip.totalFrames + 1)}
                  className="flex h-1/2 items-center justify-center rounded-t-md border border-border/50 bg-muted/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Add frame"
                >
                  <Plus className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (canRemoveTrailingFrame) {
                      onChangeTotalFrames(clip.totalFrames - 1);
                    }
                  }}
                  disabled={!canRemoveTrailingFrame}
                  className="relative -mt-px flex h-1/2 items-center justify-center rounded-b-md border border-border/50 bg-muted/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-muted/60 disabled:hover:text-muted-foreground"
                  aria-label="Remove frame"
                  title={!canRemoveTrailingFrame ? removeTrailingFrameTooltip : 'Remove last frame'}
                >
                  <Minus className="size-3" />
                </button>
              </div>
            </div>

            <div className="relative z-10 flex flex-col gap-2">
              {clip.tracks.map((track, trackIndex) => {
                const isActive = track.id === clip.activeTrackId;
                const isEditing = editingTrackId === track.id;
                const isDragged = draggedTrackId === track.id;

                return (
                  <div key={`${track.id}:${trackIndex}`} className="relative w-full">
                    {dropIndicatorIndex === trackIndex ? (
                      <div className="pointer-events-none absolute inset-x-0 -top-1 z-20 h-0 border-t-2 border-primary" />
                    ) : null}

                    <div className="flex gap-3">
                      <div className="shrink-0" style={{ width: TIMELINE_TRACK_HEADER_WIDTH }}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`${track.name} ${track.kind}`}
                          aria-pressed={isActive}
                          draggable={!isEditing}
                          onClick={() => {
                            onSelectTrack(track.id);
                          }}
                          onKeyDown={(event) => handleTrackKeyDown(event, track.id)}
                          onContextMenu={(event) => handleTrackContextMenu(event, track.id)}
                          onDragStart={(event) => handleTrackDragStart(event, track.id)}
                          onDragOver={(event) => handleTrackDragOver(event, trackIndex)}
                          onDrop={handleTrackDrop}
                          onDragEnd={clearTrackDragState}
                          className={cn(
                            'group/track-row relative flex w-full items-center gap-3 rounded-[14px] text-left outline-none',
                            isDragged && 'opacity-45',
                          )}
                        >
                          {!isActive ? (
                            <div
                              aria-hidden="true"
                              className={cn(
                                'pointer-events-none absolute inset-0 rounded-[14px] opacity-0 transition-opacity group-hover/track-row:opacity-100',
                                selectionSurfaceClassNames.hover,
                              )}
                            />
                          ) : null}

                          <div
                            aria-hidden="true"
                            className={cn(
                              'pointer-events-none absolute inset-0 rounded-[14px] transition-opacity',
                              selectionSurfaceClassNames.selected,
                              isActive ? 'opacity-100' : 'opacity-0',
                            )}
                          />

                          <div className="relative z-10 flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2">
                            <span className="inline-flex shrink-0 text-muted-foreground">
                              <TrackKindIcon kind={track.kind} />
                            </span>

                            <InlineRenameField
                              editing={isEditing}
                              value={isEditing ? renameDraft : track.name}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onBlur={() => commitInlineRename(track.id)}
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitInlineRename(track.id);
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelInlineRename();
                                }
                              }}
                              autoFocus={isEditing}
                              className="min-w-0 flex-1"
                              textClassName="min-w-0 truncate text-sm font-medium leading-5"
                              displayProps={{
                                onDoubleClick: (event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  startInlineRename(track.id, track.name);
                                },
                              }}
                            />

                            <IconButton
                              label={track.visible ? 'Hide track' : 'Show track'}
                              shape="pill"
                              size="sm"
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleVisibility(track.id);
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              {track.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                            </IconButton>
                          </div>
                        </div>
                      </div>

                      <div
                        className="relative h-10 select-none"
                        style={{ width: clip.totalFrames * TIMELINE_FRAME_WIDTH }}
                      >
                        <div className="absolute inset-0 flex">
                          {Array.from({ length: clip.totalFrames }, (_, frameIndex) => (
                            <button
                              key={`${track.id}-frame-${frameIndex}`}
                              type="button"
                              onClick={() => {
                                onSelectTrack(track.id);
                                onFrameSelect(frameIndex);
                              }}
                              className="h-full bg-transparent"
                              style={{ width: TIMELINE_FRAME_WIDTH }}
                            />
                          ))}
                        </div>

                        {track.cels.map((cel, celIndex) => {
                          const displayedCel = getDisplayedCelSpan(cel, celInteraction?.trackId === track.id ? celInteraction : null);
                          const isSelectedCel = (
                            (track.id === clip.activeTrackId && cel.id === autoSelectedCelId) ||
                            celInteraction?.celId === cel.id
                          );
                          const previousEndFrame = celIndex > 0
                            ? track.cels[celIndex - 1].startFrame + track.cels[celIndex - 1].durationFrames
                            : 0;
                          const nextStartFrame = track.cels[celIndex + 1]?.startFrame ?? clip.totalFrames;

                          return (
                            <div
                              key={`${cel.id}:${celIndex}`}
                              data-animated-cel="true"
                              className={cn(
                                'group/cel absolute inset-y-1 rounded-xl shadow-sm transition-[background-color,box-shadow]',
                                isSelectedCel
                                  ? 'bg-primary/14 shadow-[0_10px_24px_-18px_rgba(37,99,235,0.8)]'
                                  : 'bg-slate-300/88 hover:bg-slate-400/95 dark:bg-slate-700/84 dark:hover:bg-slate-600/96',
                                celInteraction?.celId === cel.id && 'z-20 shadow-md',
                              )}
                              style={{
                                left: (displayedCel.startFrame * TIMELINE_FRAME_WIDTH) + TIMELINE_CELL_HORIZONTAL_INSET,
                                width: Math.max(
                                  0,
                                  (displayedCel.durationFrames * TIMELINE_FRAME_WIDTH) - (TIMELINE_CELL_HORIZONTAL_INSET * 2),
                                ),
                              }}
                              onContextMenu={(event) => handleCelContextMenu(event, track.id, cel.id)}
                            >
                              <div
                                className={cn(
                                  'absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l-xl transition-[opacity,background-color]',
                                  isSelectedCel
                                    ? 'bg-primary/20 hover:bg-primary/30'
                                    : 'bg-slate-500/18 hover:bg-slate-500/28 dark:bg-slate-400/18 dark:hover:bg-slate-400/30',
                                  'opacity-0 group-hover/cel:opacity-100',
                                  celInteraction?.celId === cel.id && 'opacity-100',
                                )}
                                onMouseDown={(event) => beginCelInteraction(
                                  event,
                                  track.id,
                                  cel,
                                  'resize-start',
                                  previousEndFrame,
                                  nextStartFrame,
                                )}
                              />
                              <div
                                className={cn(
                                  'absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-xl transition-[opacity,background-color]',
                                  isSelectedCel
                                    ? 'bg-primary/20 hover:bg-primary/30'
                                    : 'bg-slate-500/18 hover:bg-slate-500/28 dark:bg-slate-400/18 dark:hover:bg-slate-400/30',
                                  'opacity-0 group-hover/cel:opacity-100',
                                  celInteraction?.celId === cel.id && 'opacity-100',
                                )}
                                onMouseDown={(event) => beginCelInteraction(
                                  event,
                                  track.id,
                                  cel,
                                  'resize-end',
                                  previousEndFrame,
                                  nextStartFrame,
                                )}
                              />
                              <div
                                className="flex h-full cursor-grab items-center justify-center overflow-hidden rounded-xl px-2 active:cursor-grabbing"
                                onMouseDown={(event) => beginCelInteraction(
                                  event,
                                  track.id,
                                  cel,
                                  'move',
                                  previousEndFrame,
                                  nextStartFrame,
                                )}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {dropIndicatorIndex === clip.tracks.length && trackIndex === clip.tracks.length - 1 ? (
                      <div className="pointer-events-none absolute inset-x-0 -bottom-1 z-20 h-0 border-t-2 border-primary" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {trackContextMenuTrack ? (
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: EDITOR_POPOVER_Z_INDEX - 1 }}
            onClick={closeTrackContextMenu}
          />
          <Card
            ref={trackContextMenuRef}
            className="fixed min-w-56 gap-0 rounded-2xl border-border/80 bg-surface-floating px-0 py-1.5 shadow-[0_28px_80px_-34px_rgba(2,6,23,0.78)]"
            style={{
              left: trackContextMenuPosition?.left ?? trackContextMenu?.x ?? 0,
              top: trackContextMenuPosition?.top ?? trackContextMenu?.y ?? 0,
              zIndex: EDITOR_POPOVER_Z_INDEX,
            }}
          >
            <div className="px-3 py-2">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                <span>Opacity</span>
                <span>{trackContextMenuOpacityDraft}%</span>
              </div>
              <input
                aria-label="Track opacity"
                type="range"
                min={0}
                max={100}
                step={1}
                value={trackContextMenuOpacityDraft}
                onChange={(event) => setTrackContextMenuOpacityDraft(clampOpacityPercent(Number(event.target.value)))}
                onPointerUp={(event) => commitTrackContextMenuOpacity(Number(event.currentTarget.value))}
                onKeyUp={(event) => commitTrackContextMenuOpacity(Number(event.currentTarget.value))}
                onBlur={(event) => commitTrackContextMenuOpacity(Number(event.currentTarget.value))}
                className="w-full accent-primary"
              />
            </div>

            <MenuSeparator />

            <MenuItemButton
              icon={<Copy className="size-4" />}
              onClick={() => {
                onDuplicateTrack(trackContextMenuTrack.id);
                closeTrackContextMenu();
              }}
            >
              Duplicate
            </MenuItemButton>

            <MenuItemButton
              icon={trackContextMenuTrack.locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
              onClick={() => {
                onToggleLocked(trackContextMenuTrack.id);
                closeTrackContextMenu();
              }}
            >
              {trackContextMenuTrack.locked ? 'Unlock' : 'Lock'}
            </MenuItemButton>

            <MenuItemButton
              icon={<Trash2 className="size-4" />}
              intent="destructive"
              onClick={() => {
                onDeleteTrack(trackContextMenuTrack.id);
                closeTrackContextMenu();
              }}
              disabled={clip.tracks.length <= 1}
            >
              Delete
            </MenuItemButton>
          </Card>
        </>
      ) : null}

      {celContextMenu && celContextMenuTrack && celContextMenuCel ? (
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: EDITOR_POPOVER_Z_INDEX - 1 }}
            onClick={closeCelContextMenu}
          />
          <Card
            ref={celContextMenuRef}
            className="fixed min-w-44 gap-0 rounded-2xl border-border/80 bg-surface-floating px-0 py-1.5 shadow-[0_28px_80px_-34px_rgba(2,6,23,0.78)]"
            style={{
              left: celContextMenuPosition?.left ?? celContextMenu.x,
              top: celContextMenuPosition?.top ?? celContextMenu.y,
              zIndex: EDITOR_POPOVER_Z_INDEX,
            }}
          >
            <MenuItemButton
              icon={<Trash2 className="size-4" />}
              intent="destructive"
              onClick={() => {
                onDeleteCel(celContextMenuTrack.id, celContextMenuCel.id);
                closeCelContextMenu();
              }}
              disabled={celContextMenuTrack.cels.length <= 1}
            >
              Delete Cel
            </MenuItemButton>
          </Card>
        </>
      ) : null}
    </>
  );
}
