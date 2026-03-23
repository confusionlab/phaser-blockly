import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getVisiblePeaks, type WaveformData } from '@/lib/audioWaveform';

const MIN_TRIM_SECONDS = 0.1;
const WAVEFORM_BASE_FILL = '#b8b8b8';
const WAVEFORM_PLAYED_FILL = '#5f5f5f';
const TRIM_ACCENT = '#6b6b6b';

interface WaveformViewportProps {
  waveform: WaveformData | null;
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  showTrimControls?: boolean;
  onSeek?: (time: number) => void;
  onTrimCommit?: (trimStart: number, trimEnd: number) => void;
  className?: string;
}

type InteractionMode = 'trim-start' | 'trim-end' | 'seek' | null;

const StaticWaveformBars = memo(function StaticWaveformBars({
  bars,
  fill,
}: {
  bars: number[];
  fill: string;
}) {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((peak, index) => {
        const x = (index / bars.length) * 100;
        const width = 100 / bars.length;
        const height = Math.max(peak * 76, 3);

        return (
          <rect
            key={index}
            x={x}
            y={50 - height / 2}
            width={Math.max(width * 0.72, 0.32)}
            height={height}
            rx={0.28}
            fill={fill}
          />
        );
      })}
    </svg>
  );
});

export function WaveformViewport({
  waveform,
  duration,
  currentTime,
  trimStart,
  trimEnd,
  showTrimControls = true,
  onSeek,
  onTrimCommit,
  className,
}: WaveformViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const interactionModeRef = useRef<InteractionMode>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTargetRef = useRef<HTMLElement | null>(null);
  const draftTrimRef = useRef({ trimStart, trimEnd });
  const scrubRafRef = useRef<number | null>(null);
  const durationRef = useRef(duration);
  const visibleStartRef = useRef(0);
  const visibleEndRef = useRef(duration);
  const onSeekRef = useRef(onSeek);
  const onTrimCommitRef = useRef(onTrimCommit);

  const [containerWidth, setContainerWidth] = useState(0);
  const [draftTrim, setDraftTrim] = useState({ trimStart, trimEnd });

  durationRef.current = duration;
  onSeekRef.current = onSeek;
  onTrimCommitRef.current = onTrimCommit;

  const displayedTrimStart = draftTrim.trimStart;
  const displayedTrimEnd = draftTrim.trimEnd;
  const visibleStart = showTrimControls ? 0 : displayedTrimStart;
  const visibleEnd = showTrimControls ? duration : displayedTrimEnd;
  const visibleDuration = Math.max(MIN_TRIM_SECONDS, visibleEnd - visibleStart);

  visibleStartRef.current = visibleStart;
  visibleEndRef.current = visibleEnd;

  useEffect(() => {
    if (interactionModeRef.current === 'trim-start' || interactionModeRef.current === 'trim-end') {
      return;
    }

    const nextDraft = { trimStart, trimEnd };
    draftTrimRef.current = nextDraft;
    setDraftTrim(nextDraft);
  }, [trimEnd, trimStart]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });

    observer.observe(element);
    setContainerWidth(element.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  const bars = useMemo(() => {
    if (!waveform || visibleDuration <= 0) {
      return [];
    }

    const barCount = Math.max(72, Math.floor(containerWidth / 4));
    return getVisiblePeaks(waveform, visibleStart, visibleDuration, barCount);
  }, [containerWidth, visibleDuration, visibleStart, waveform]);

  useEffect(() => {
    return () => {
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
      }

      activePointerTargetRef.current = null;
      activePointerIdRef.current = null;
    };
  }, []);

  const updateTimeFromClientX = useCallback((clientX: number): number | null => {
    const element = containerRef.current;
    if (!element || durationRef.current <= 0) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const visibleDuration = visibleEndRef.current - visibleStartRef.current;
    const clampedTime = Math.max(
      visibleStartRef.current,
      Math.min(
        visibleEndRef.current,
        visibleStartRef.current + ((clientX - rect.left) / rect.width) * visibleDuration,
      ),
    );
    return clampedTime;
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interactionMode = interactionModeRef.current;
      if (!interactionMode || (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current)) {
        return;
      }

      const nextTime = updateTimeFromClientX(event.clientX);
      if (nextTime === null) {
        return;
      }

      if (interactionMode === 'seek') {
        if (!onSeekRef.current) {
          return;
        }

        if (scrubRafRef.current !== null) {
          window.cancelAnimationFrame(scrubRafRef.current);
        }
        scrubRafRef.current = window.requestAnimationFrame(() => {
          onSeekRef.current?.(nextTime);
        });
        return;
      }

      const currentDraft = draftTrimRef.current;
      const nextDraft = interactionMode === 'trim-start'
        ? {
            trimStart: Math.min(nextTime, currentDraft.trimEnd - MIN_TRIM_SECONDS),
            trimEnd: currentDraft.trimEnd,
          }
        : {
            trimStart: currentDraft.trimStart,
            trimEnd: Math.max(nextTime, currentDraft.trimStart + MIN_TRIM_SECONDS),
          };

      draftTrimRef.current = nextDraft;
      setDraftTrim(nextDraft);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const interactionMode = interactionModeRef.current;
      if (!interactionMode || (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current)) {
        return;
      }

      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }

      interactionModeRef.current = null;
      activePointerIdRef.current = null;

      const captureTarget = activePointerTargetRef.current;
      if (captureTarget?.hasPointerCapture(event.pointerId)) {
        captureTarget.releasePointerCapture(event.pointerId);
      }
      activePointerTargetRef.current = null;

      if ((interactionMode === 'trim-start' || interactionMode === 'trim-end') && showTrimControls) {
        onTrimCommitRef.current?.(draftTrimRef.current.trimStart, draftTrimRef.current.trimEnd);
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [showTrimControls, updateTimeFromClientX]);

  const startPercent = duration > 0 ? (displayedTrimStart / duration) * 100 : 0;
  const endPercent = duration > 0 ? (displayedTrimEnd / duration) * 100 : 100;
  const playheadPercent = visibleDuration > 0
    ? Math.max(0, Math.min(100, ((currentTime - visibleStart) / visibleDuration) * 100))
    : 0;
  const playedSelectedPercent = showTrimControls && duration > 0
    ? Math.max(0, Math.min((currentTime / duration) * 100, endPercent) - startPercent)
    : Math.max(0, Math.min(playheadPercent, 100));
  const playedOverlayStartPercent = showTrimControls ? startPercent : 0;

  const beginScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek) {
      return;
    }

    const nextTime = updateTimeFromClientX(event.clientX);
    if (nextTime === null) {
      return;
    }

    activePointerIdRef.current = event.pointerId;
    activePointerTargetRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionModeRef.current = 'seek';
    onSeek(nextTime);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-52 overflow-hidden rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(247,247,247,0.98),rgba(237,237,237,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] touch-none select-none',
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        beginScrub(event);
      }}
    >
      <div className="pointer-events-none absolute inset-x-6 top-0 h-20 rounded-full bg-[radial-gradient(circle_at_top,rgba(120,120,120,0.12),transparent_70%)]" />

      {bars.length > 0 ? (
        <>
          <StaticWaveformBars bars={bars} fill={WAVEFORM_BASE_FILL} />

          <div
            className="pointer-events-none absolute inset-0"
            style={{
              clipPath: `inset(0 ${Math.max(0, 100 - (playedOverlayStartPercent + playedSelectedPercent))}% 0 ${playedOverlayStartPercent}%)`,
            }}
          >
            <StaticWaveformBars bars={bars} fill={WAVEFORM_PLAYED_FILL} />
          </div>

          {showTrimControls ? (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/16" style={{ width: `${startPercent}%` }} />
              <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/16" style={{ width: `${Math.max(0, 100 - endPercent)}%` }} />
                <div
                className="pointer-events-none absolute inset-y-3 rounded-[14px] border border-white/60 bg-white/15 shadow-[inset_0_0_0_1px_rgba(90,90,90,0.12)]"
                  style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
                />
            </>
          ) : null}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 -translate-x-1/2"
            style={{ left: `${playheadPercent}%` }}
          >
            <div className="mx-auto size-3 rounded-full border border-white/80 bg-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.3)]" />
            <div className="mx-auto h-full w-0.5 bg-foreground/90 shadow-[0_0_0_1px_rgba(255,255,255,0.3)]" />
          </div>
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Preparing waveform...
        </div>
      )}

      {showTrimControls ? (
        <>
          <button
            type="button"
            className="absolute inset-y-4 z-20 w-4 -translate-x-1/2 cursor-ew-resize rounded-full border border-white/70 shadow-sm"
            style={{ left: `${startPercent}%`, backgroundColor: TRIM_ACCENT }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              activePointerIdRef.current = event.pointerId;
              activePointerTargetRef.current = event.currentTarget;
              event.currentTarget.setPointerCapture(event.pointerId);
              interactionModeRef.current = 'trim-start';
              draftTrimRef.current = { trimStart: displayedTrimStart, trimEnd: displayedTrimEnd };
            }}
          >
            <span className="mx-auto block h-10 w-1 rounded-full bg-white/90" />
            <span className="sr-only">Adjust start trim</span>
          </button>

          <button
            type="button"
            className="absolute inset-y-4 z-20 w-4 -translate-x-1/2 cursor-ew-resize rounded-full border border-white/70 shadow-sm"
            style={{ left: `${endPercent}%`, backgroundColor: TRIM_ACCENT }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              activePointerIdRef.current = event.pointerId;
              activePointerTargetRef.current = event.currentTarget;
              event.currentTarget.setPointerCapture(event.pointerId);
              interactionModeRef.current = 'trim-end';
              draftTrimRef.current = { trimStart: displayedTrimStart, trimEnd: displayedTrimEnd };
            }}
          >
            <span className="mx-auto block h-10 w-1 rounded-full bg-white/90" />
            <span className="sr-only">Adjust end trim</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
