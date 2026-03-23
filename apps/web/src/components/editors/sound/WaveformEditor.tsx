import { type ChangeEvent, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatAudioTime, generateWaveform, type WaveformData } from '@/lib/audioWaveform';
import { WaveformViewport } from './WaveformViewport';
import type { Sound } from '@/types';
import { Mic, Play, RotateCcw, Square, Volume2, VolumeX } from 'lucide-react';

interface WaveformEditorProps {
  sound: Sound | null;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  onCreateRecording: () => void;
}

export const WaveformEditor = memo(({ sound, onTrimChange, onCreateRecording }: WaveformEditorProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);

  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  const activeDuration = useMemo(() => Math.max(0, trimEnd - trimStart), [trimEnd, trimStart]);
  const isTrimmed = useMemo(
    () => duration > 0 && (trimStart > 0.001 || trimEnd < duration - 0.001),
    [duration, trimEnd, trimStart],
  );

  useEffect(() => {
    if (!sound) {
      audioRef.current?.pause();
      audioRef.current = null;
      setWaveform(null);
      setDuration(0);
      setCurrentTime(0);
      setTrimStart(0);
      setTrimEnd(0);
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(sound.assetId);
    audio.preload = 'metadata';
    audioRef.current?.pause();
    audioRef.current = audio;
    setIsPlaying(false);

    const handleMetadata = () => {
      const nextDuration = Number.isFinite(sound.duration) && sound.duration ? sound.duration : audio.duration;
      const nextTrimStart = Math.max(0, Math.min(sound.trimStart ?? 0, nextDuration));
      const nextTrimEnd = Math.max(nextTrimStart, Math.min(sound.trimEnd ?? nextDuration, nextDuration));

      setDuration(nextDuration);
      setTrimStart(nextTrimStart);
      setTrimEnd(nextTrimEnd);
      setCurrentTime(nextTrimStart);
      audio.currentTime = nextTrimStart;
    };

    const handleTimeUpdate = () => {
      if (audio.currentTime >= trimEndRef.current) {
        audio.pause();
        audio.currentTime = trimStartRef.current;
        setCurrentTime(trimStartRef.current);
        setIsPlaying(false);
        return;
      }

      setCurrentTime(audio.currentTime);
    };

    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(trimStartRef.current);
    };

    audio.onloadedmetadata = handleMetadata;
    audio.ontimeupdate = handleTimeUpdate;
    audio.onpause = handlePause;
    audio.onplay = handlePlay;
    audio.onended = handleEnded;

    setIsLoadingWaveform(true);
    void generateWaveform(sound.assetId)
      .then((nextWaveform) => setWaveform(nextWaveform))
      .catch((error) => {
        console.error('Failed to generate waveform:', error);
        setWaveform(null);
      })
      .finally(() => setIsLoadingWaveform(false));

    return () => {
      audio.pause();
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onpause = null;
      audio.onplay = null;
      audio.onended = null;
    };
  }, [sound]);

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

  const handleTogglePlay = () => {
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
  };

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

  const resetTrim = () => {
    setTrimStart(0);
    setTrimEnd(duration);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    onTrimChange(0, duration);
  };

  if (!sound) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-8 text-center shadow-sm">
          <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-[#edf5ef] text-[#5e7f6c]">
            <Volume2 className="size-11" />
          </div>
          <h3 className="mt-6 text-2xl font-semibold text-foreground">Select a sound to shape it</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            The Tutumation-inspired editor lives here: dense waveform, direct trim handles, and transport controls that fit the rest of this app.
          </p>
          <Button className="mt-8 rounded-full px-5" onClick={onCreateRecording}>
            <Mic className="size-4" />
            Record a New Sound
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-5">
      <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b8b77]">Sound Studio</div>
            <h2 className="mt-1 text-2xl font-semibold text-foreground">{sound.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Click the waveform to audition, then drag the sage handles to define the active clip.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="rounded-full" onClick={handleRestart}>
              <RotateCcw className="size-4" />
              Restart
            </Button>
            <Button className="rounded-full px-5" onClick={handleTogglePlay}>
              {isPlaying ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
              {isPlaying ? 'Stop' : 'Play'}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-[22px] border border-border/70 bg-white/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Start</div>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">{formatAudioTime(trimStart, true)}</div>
          </div>
          <div className="rounded-[22px] border border-border/70 bg-white/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Clip Length</div>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">{formatAudioTime(activeDuration, true)}</div>
          </div>
          <div className="rounded-[22px] border border-border/70 bg-white/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">End</div>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">{formatAudioTime(trimEnd, true)}</div>
          </div>
          <div className="rounded-[22px] border border-border/70 bg-white/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Status</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{isTrimmed ? 'Edited clip' : 'Full clip'}</div>
            <div className="mt-1 text-xs text-muted-foreground">Original {formatAudioTime(duration, true)}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-[28px] border border-border/70 bg-background/95 p-4 shadow-sm">
        <WaveformViewport
          waveform={waveform}
          duration={duration}
          currentTime={currentTime}
          trimStart={trimStart}
          trimEnd={trimEnd}
          onSeek={handleSeek}
          onTrimCommit={(nextStart, nextEnd) => {
            setTrimStart(nextStart);
            setTrimEnd(nextEnd);
            onTrimChange(nextStart, nextEnd);
          }}
          className={cn(isLoadingWaveform && 'opacity-70')}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-3 py-1">Playhead {formatAudioTime(currentTime, true)}</span>
            <span className="rounded-full bg-muted px-3 py-1">Full take {formatAudioTime(duration, true)}</span>
          </div>
          <span>Trim updates are non-destructive and stay attached to the sound.</span>
        </div>
      </div>

      <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="rounded-full" onClick={resetTrim} disabled={!duration}>
              <RotateCcw className="size-4" />
              Reset Trim
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={toggleMute}>
              {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              {isMuted ? 'Muted' : 'Volume'}
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

          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Selected range</div>
            <div className="mt-1 font-mono text-sm text-foreground">
              {formatAudioTime(trimStart, true)} to {formatAudioTime(trimEnd, true)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

WaveformEditor.displayName = 'WaveformEditor';
