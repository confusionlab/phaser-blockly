import type { AnimatedCostumeClip } from '@/types';
import { getAnimatedCostumeTrackCelAtFrame } from '@/lib/costume/costumeDocument';

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
  onChangeCelDuration: (trackId: string, celId: string, durationFrames: number) => void;
  onDeleteCel: (trackId: string, celId: string) => void;
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
  onChangeCelDuration,
  onDeleteCel,
}: AnimatedCostumeTimelineProps) {
  return (
    <div className="border-t border-border/70 bg-background/95">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-3 py-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Frames</span>
          <input
            type="number"
            min={1}
            value={clip.totalFrames}
            onChange={(event) => onChangeTotalFrames(Number(event.target.value))}
            className="h-7 w-16 rounded border border-input bg-background px-2 text-xs"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">FPS</span>
          <input
            type="number"
            min={1}
            value={clip.fps}
            onChange={(event) => onChangeFps(Number(event.target.value))}
            className="h-7 w-16 rounded border border-input bg-background px-2 text-xs"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Playback</span>
          <select
            value={clip.playback}
            onChange={(event) => onChangePlayback(event.target.value as AnimatedCostumeClip['playback'])}
            className="h-7 rounded border border-input bg-background px-2 text-xs"
          >
            <option value="play-once">Play Once</option>
            <option value="loop">Loop</option>
            <option value="ping-pong">Ping-Pong</option>
          </select>
        </label>
        <button
          type="button"
          onClick={onAddBitmapTrack}
          className="rounded border border-input px-2 py-1 text-xs text-foreground transition hover:bg-accent"
        >
          + Bitmap Track
        </button>
        <button
          type="button"
          onClick={onAddVectorTrack}
          className="rounded border border-input px-2 py-1 text-xs text-foreground transition hover:bg-accent"
        >
          + Vector Track
        </button>
      </div>

      <div className="overflow-auto px-3 py-3">
        <div className="min-w-max">
          <div className="mb-2 flex items-center gap-1 pl-[230px]">
            {Array.from({ length: clip.totalFrames }, (_, frameIndex) => (
              <button
                key={`frame-header-${frameIndex}`}
                type="button"
                onClick={() => onFrameSelect(frameIndex)}
                className={`flex h-8 w-8 items-center justify-center rounded text-[11px] ${
                  frameIndex === currentFrameIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-accent'
                }`}
              >
                {frameIndex + 1}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {clip.tracks.map((track, trackIndex) => {
              const currentCel = getAnimatedCostumeTrackCelAtFrame(track, currentFrameIndex);
              return (
                <div
                  key={track.id}
                  className={`rounded-lg border p-2 ${
                    track.id === clip.activeTrackId
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border/60 bg-card'
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="w-[220px] shrink-0">
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectTrack(track.id)}
                          className={`rounded px-2 py-1 text-xs ${
                            track.id === clip.activeTrackId
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground'
                          }`}
                        >
                          {track.kind}
                        </button>
                        <button
                          type="button"
                          onClick={() => onReorderTrack(track.id, Math.max(0, trackIndex - 1))}
                          disabled={trackIndex === 0}
                          className="rounded border border-input px-2 py-1 text-xs disabled:opacity-40"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => onReorderTrack(track.id, Math.min(clip.tracks.length - 1, trackIndex + 1))}
                          disabled={trackIndex === clip.tracks.length - 1}
                          className="rounded border border-input px-2 py-1 text-xs disabled:opacity-40"
                        >
                          Down
                        </button>
                      </div>

                      <input
                        type="text"
                        value={track.name}
                        onChange={(event) => onRenameTrack(track.id, event.target.value)}
                        className="mb-2 h-8 w-full rounded border border-input bg-background px-2 text-sm"
                      />

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => onToggleVisibility(track.id)}
                          className="rounded border border-input px-2 py-1"
                        >
                          {track.visible ? 'Visible' : 'Hidden'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleLocked(track.id)}
                          className="rounded border border-input px-2 py-1"
                        >
                          {track.locked ? 'Locked' : 'Unlocked'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicateTrack(track.id)}
                          className="rounded border border-input px-2 py-1"
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTrack(track.id)}
                          className="rounded border border-destructive/40 px-2 py-1 text-destructive"
                        >
                          Delete
                        </button>
                      </div>

                      <label className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Opacity</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.opacity}
                          onChange={(event) => onOpacityChange(track.id, Number(event.target.value))}
                          className="flex-1"
                        />
                      </label>

                      {currentCel ? (
                        <div className="mt-3 rounded border border-border/60 bg-muted/40 p-2 text-xs">
                          <div className="font-medium">Current Cel</div>
                          <div className="mt-1 text-muted-foreground">
                            Starts at frame {currentCel.startFrame + 1}
                          </div>
                          <label className="mt-2 flex items-center gap-2">
                            <span className="text-muted-foreground">Duration</span>
                            <input
                              type="number"
                              min={1}
                              value={currentCel.durationFrames}
                              onChange={(event) => onChangeCelDuration(track.id, currentCel.id, Number(event.target.value))}
                              className="h-7 w-16 rounded border border-input bg-background px-2 text-xs"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => onDeleteCel(track.id, currentCel.id)}
                            className="mt-2 rounded border border-destructive/40 px-2 py-1 text-destructive"
                          >
                            Delete Cel
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 rounded border border-dashed border-border/60 px-2 py-2 text-xs text-muted-foreground">
                          No cel on the selected frame yet. Paint on this frame to create one.
                        </div>
                      )}
                    </div>

                    <div className="flex min-w-max items-center gap-1">
                      {Array.from({ length: clip.totalFrames }, (_, frameIndex) => {
                        const cel = getAnimatedCostumeTrackCelAtFrame(track, frameIndex);
                        const isCelStart = !!cel && cel.startFrame === frameIndex;
                        const isCurrentFrame = frameIndex === currentFrameIndex;
                        return (
                          <button
                            key={`${track.id}-${frameIndex}`}
                            type="button"
                            onClick={() => {
                              onSelectTrack(track.id);
                              onFrameSelect(frameIndex);
                            }}
                            className={`relative flex h-8 w-8 items-center justify-center rounded border text-[11px] ${
                              isCurrentFrame
                                ? 'border-primary bg-primary text-primary-foreground'
                                : cel
                                  ? (isCelStart ? 'border-emerald-500 bg-emerald-100 text-emerald-900' : 'border-emerald-200 bg-emerald-50 text-emerald-700')
                                  : 'border-border/60 bg-background text-muted-foreground hover:bg-accent'
                            }`}
                            title={cel ? `${track.name}: cel ${cel.startFrame + 1}-${cel.startFrame + cel.durationFrames}` : `${track.name}: empty frame`}
                          >
                            {cel ? (isCelStart ? '●' : '•') : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
