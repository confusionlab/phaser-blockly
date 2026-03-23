import { type ChangeEvent, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { generateWaveform, getCachedWaveform, type WaveformData } from '@/lib/audioWaveform';
import { EditorToolbar } from '@/components/editors/shared/EditorToolbar';
import type { Sound } from '@/types';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import { Play, RotateCcw, Scissors, Square, Volume2, VolumeX } from 'lucide-react';
import { WaveformViewport } from './WaveformViewport';

interface SoundClipEditorProps {
  sound: Sound;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  footer?: ReactNode;
}

export const SoundClipEditor = memo(({ sound, onTrimChange, footer }: SoundClipEditorProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playheadRafRef = useRef<number | null>(null);
  const waveformLoadIdRef = useRef(0);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);

  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);

  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  const stopPlayheadLoop = useCallback(() => {
    if (playheadRafRef.current !== null) {
      window.cancelAnimationFrame(playheadRafRef.current);
      playheadRafRef.current = null;
    }
  }, []);

  const startPlayheadLoop = useCallback(() => {
    stopPlayheadLoop();

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) {
        playheadRafRef.current = null;
        return;
      }

      if (audio.currentTime >= trimEndRef.current) {
        audio.pause();
        audio.currentTime = trimStartRef.current;
        setCurrentTime(trimStartRef.current);
        setIsPlaying(false);
        playheadRafRef.current = null;
        return;
      }

      if (audio.paused || audio.ended) {
        setCurrentTime(audio.currentTime);
        playheadRafRef.current = null;
        return;
      }

      setCurrentTime(audio.currentTime);
      playheadRafRef.current = window.requestAnimationFrame(tick);
    };

    playheadRafRef.current = window.requestAnimationFrame(tick);
  }, [stopPlayheadLoop]);

  useEffect(() => {
    const audio = new Audio(sound.assetId);
    audio.preload = 'metadata';
    audioRef.current?.pause();
    audioRef.current = audio;
    setIsPlaying(false);
    setIsTrimming(false);

    const hintedDuration = typeof sound.duration === 'number' && Number.isFinite(sound.duration)
      ? sound.duration
      : 0;
    if (hintedDuration > 0) {
      const hintedTrimStart = Math.max(0, Math.min(sound.trimStart ?? 0, hintedDuration));
      const hintedTrimEnd = Math.max(hintedTrimStart, Math.min(sound.trimEnd ?? hintedDuration, hintedDuration));
      setDuration(hintedDuration);
      setTrimStart(hintedTrimStart);
      setTrimEnd(hintedTrimEnd);
      setCurrentTime(hintedTrimStart);
      audio.currentTime = hintedTrimStart;
    }

    const handleMetadata = () => {
      const nextDuration = Number.isFinite(sound.duration) && sound.duration ? sound.duration : audio.duration;
      const nextTrimStart = Math.max(0, Math.min(sound.trimStart ?? 0, nextDuration));
      const nextTrimEnd = Math.max(nextTrimStart, Math.min(sound.trimEnd ?? nextDuration, nextDuration));

      setDuration(nextDuration);
      setTrimStart(nextTrimStart);
      setTrimEnd(nextTrimEnd);
      setCurrentTime(nextTrimStart);
      setIsTrimming(false);
      audio.currentTime = nextTrimStart;
    };

    const handlePause = () => {
      stopPlayheadLoop();
      setIsPlaying(false);
      setCurrentTime(audio.currentTime);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      startPlayheadLoop();
    };

    const handleEnded = () => {
      stopPlayheadLoop();
      setIsPlaying(false);
      setCurrentTime(trimStartRef.current);
    };

    audio.onloadedmetadata = handleMetadata;
    audio.onpause = handlePause;
    audio.onplay = handlePlay;
    audio.onended = handleEnded;

    const waveformLoadId = waveformLoadIdRef.current + 1;
    waveformLoadIdRef.current = waveformLoadId;
    const cachedWaveform = getCachedWaveform(sound.assetId);

    if (cachedWaveform) {
      setWaveform(cachedWaveform);
    }

    void generateWaveform(sound.assetId)
      .then((nextWaveform) => {
        if (waveformLoadIdRef.current !== waveformLoadId) {
          return;
        }

        setWaveform(nextWaveform);
      })
      .catch((error) => {
        if (waveformLoadIdRef.current !== waveformLoadId) {
          return;
        }

        console.error('Failed to generate waveform:', error);
        setWaveform(null);
      });

    return () => {
      waveformLoadIdRef.current += 1;
      stopPlayheadLoop();
      audio.pause();
      audio.onloadedmetadata = null;
      audio.onpause = null;
      audio.onplay = null;
      audio.onended = null;
    };
  }, [sound, startPlayheadLoop, stopPlayheadLoop]);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.volume = isMuted ? 0 : volume;
  }, [isMuted, volume]);

  const handleSeek = (nextTime: number) => {
    if (!audioRef.current) {
      return;
    }

    const clamped = Math.max(trimStart, Math.min(trimEnd, nextTime));
    audioRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const handleTogglePlay = useCallback(() => {
    if (!audioRef.current) {
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
      return;
    }

    if (audioRef.current.currentTime < trimStart || audioRef.current.currentTime >= trimEnd) {
      audioRef.current.currentTime = trimStart;
      setCurrentTime(trimStart);
    }

    void audioRef.current.play().catch((error) => {
      console.error('Failed to play sound preview:', error);
      setIsPlaying(false);
    });
  }, [isPlaying, trimEnd, trimStart]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalKeyboardEvent(event)) {
        return;
      }

      if (event.code !== 'Space' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      event.preventDefault();
      handleTogglePlay();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlay]);

  const handleRestart = () => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.currentTime = trimStart;
    setCurrentTime(trimStart);
    if (!isPlaying) {
      void audioRef.current.play().catch((error) => {
        console.error('Failed to restart sound preview:', error);
      });
    }
  };

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Number.parseFloat(event.target.value);
    setVolume(nextVolume);
    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
    }
    if (nextVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.volume = nextMuted ? 0 : volume;
    }
  };

  const handleTrimAction = () => {
    if (!isTrimming) {
      setIsTrimming(true);
      return;
    }

    onTrimChange(trimStart, trimEnd);
    setIsTrimming(false);
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <EditorToolbar contentClassName="grid min-w-full gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={isTrimming ? 'default' : 'outline'}
            className="rounded-full"
            onClick={handleTrimAction}
            disabled={!duration}
          >
            <Scissors className="size-4" />
            {isTrimming ? 'Done' : 'Trim'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button className="size-9 rounded-full" size="icon" onClick={handleTogglePlay} title={isPlaying ? 'Stop' : 'Play'}>
            {isPlaying ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          </Button>
          <Button variant="outline" size="icon" className="size-9 rounded-full" onClick={handleRestart} title="Restart">
            <RotateCcw className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-self-end">
          <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="h-2 w-32 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
        </div>
      </EditorToolbar>

      <div className="flex-1 min-h-0 p-4 md:p-5">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="flex-1 min-h-0 rounded-[28px] border border-border/70 bg-background/95 p-4 shadow-sm">
            <WaveformViewport
              waveform={waveform}
              duration={duration}
              currentTime={currentTime}
              trimStart={trimStart}
              trimEnd={trimEnd}
              showTrimControls={isTrimming}
              onSeek={handleSeek}
              onTrimCommit={(nextStart, nextEnd) => {
                setTrimStart(nextStart);
                setTrimEnd(nextEnd);
              }}
            />
          </div>

          {footer ? footer : null}
        </div>
      </div>
    </div>
  );
});

SoundClipEditor.displayName = 'SoundClipEditor';
