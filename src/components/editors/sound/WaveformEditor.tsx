import { useRef, useState, useEffect, useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Square, SkipBack, Volume2, VolumeX } from 'lucide-react';
import type { Sound } from '@/types';
import { cn } from '@/lib/utils';

interface WaveformEditorProps {
  sound: Sound | null;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
}

export const WaveformEditor = memo(({ sound, onTrimChange }: WaveformEditorProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);

  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Trim state (in seconds)
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | null>(null);

  // Load audio and generate waveform when sound changes
  useEffect(() => {
    if (!sound) {
      setWaveformData([]);
      setDuration(0);
      setCurrentTime(0);
      setTrimStart(0);
      setTrimEnd(0);
      return;
    }

    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);

    // Create audio element
    const audio = new Audio(sound.assetId);
    audioRef.current = audio;

    audio.onloadedmetadata = () => {
      const audioDuration = audio.duration;
      setDuration(audioDuration);
      setTrimStart(sound.trimStart ?? 0);
      setTrimEnd(sound.trimEnd ?? audioDuration);
      setCurrentTime(sound.trimStart ?? 0);
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
      // Stop at trim end
      if (audio.currentTime >= trimEnd) {
        audio.pause();
        audio.currentTime = trimStart;
        setIsPlaying(false);
      }
    };

    audio.onended = () => {
      setIsPlaying(false);
      audio.currentTime = trimStart;
      setCurrentTime(trimStart);
    };

    // Generate waveform data
    generateWaveform(sound.assetId);

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [sound?.id, sound?.assetId]);

  // Update trim end when trim values change (for the audio stop position)
  useEffect(() => {
    if (audioRef.current && trimEnd > 0) {
      // If currently playing past the new trim end, reset
      if (audioRef.current.currentTime >= trimEnd) {
        audioRef.current.pause();
        audioRef.current.currentTime = trimStart;
        setIsPlaying(false);
        setCurrentTime(trimStart);
      }
    }
  }, [trimEnd, trimStart]);

  const generateWaveform = async (dataUrl: string) => {
    try {
      // Lazy init AudioContext
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const audioContext = audioContextRef.current;

      // Fetch and decode audio
      const response = await fetch(dataUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get audio data from the first channel
      const rawData = audioBuffer.getChannelData(0);
      const samples = 200; // Number of bars to display
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData: number[] = [];

      for (let i = 0; i < samples; i++) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[i * blockSize + j]);
        }
        filteredData.push(sum / blockSize);
      }

      // Normalize the data
      const maxVal = Math.max(...filteredData);
      const normalizedData = filteredData.map((v) => v / maxVal);
      setWaveformData(normalizedData);
    } catch (error) {
      console.error('Failed to generate waveform:', error);
      setWaveformData([]);
    }
  };

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || waveformData.length === 0 || duration === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = canvas.width / waveformData.length;
      const barGap = 1;
      const centerY = canvas.height / 2;
      const maxBarHeight = canvas.height * 0.8;

      // Draw trimmed-out regions (dimmed)
      const trimStartX = (trimStart / duration) * canvas.width;
      const trimEndX = (trimEnd / duration) * canvas.width;

      // Draw background for trimmed-out areas
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fillRect(0, 0, trimStartX, canvas.height);
      ctx.fillRect(trimEndX, 0, canvas.width - trimEndX, canvas.height);

      // Draw waveform bars
      waveformData.forEach((value, index) => {
        const x = index * barWidth;
        const barHeight = value * maxBarHeight;

        // Check if this bar is in the trimmed region
        const barPosition = (index / waveformData.length) * duration;
        const isInTrimRegion = barPosition >= trimStart && barPosition <= trimEnd;

        // Color based on position relative to playhead and trim region
        const playheadPosition = (currentTime / duration) * canvas.width;

        if (!isInTrimRegion) {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.4)'; // Muted gray for trimmed out
        } else if (x < playheadPosition) {
          ctx.fillStyle = 'hsl(var(--primary))'; // Primary color for played
        } else {
          ctx.fillStyle = 'hsl(var(--primary) / 0.5)'; // Lighter for unplayed
        }

        // Draw bar (symmetric around center)
        ctx.fillRect(
          x + barGap / 2,
          centerY - barHeight / 2,
          barWidth - barGap,
          barHeight
        );
      });

      // Draw playhead
      const playheadX = (currentTime / duration) * canvas.width;
      ctx.strokeStyle = 'hsl(var(--foreground))';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, canvas.height);
      ctx.stroke();

      // Draw trim handles
      ctx.fillStyle = 'hsl(var(--primary))';

      // Start handle
      ctx.fillRect(trimStartX - 4, 0, 8, canvas.height);
      ctx.fillStyle = 'white';
      ctx.fillRect(trimStartX - 1, canvas.height * 0.3, 2, canvas.height * 0.4);

      // End handle
      ctx.fillStyle = 'hsl(var(--primary))';
      ctx.fillRect(trimEndX - 4, 0, 8, canvas.height);
      ctx.fillStyle = 'white';
      ctx.fillRect(trimEndX - 1, canvas.height * 0.3, 2, canvas.height * 0.4);
    };

    draw();

    // Animate during playback
    if (isPlaying) {
      const animate = () => {
        draw();
        animationRef.current = requestAnimationFrame(animate);
      };
      animate();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [waveformData, currentTime, duration, trimStart, trimEnd, isPlaying]);

  // Handle mouse events for trimming and seeking
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || duration === 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickTime = (x / rect.width) * duration;

      // Check if clicking on trim handles (within 10px)
      const trimStartX = (trimStart / duration) * rect.width;
      const trimEndX = (trimEnd / duration) * rect.width;

      if (Math.abs(x - trimStartX) < 10) {
        setIsDragging('start');
      } else if (Math.abs(x - trimEndX) < 10) {
        setIsDragging('end');
      } else {
        // Seek to position (only within trim region)
        const seekTime = Math.max(trimStart, Math.min(trimEnd, clickTime));
        if (audioRef.current) {
          audioRef.current.currentTime = seekTime;
          setCurrentTime(seekTime);
        }
      }
    },
    [duration, trimStart, trimEnd]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging) return;
      const canvas = canvasRef.current;
      if (!canvas || duration === 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newTime = Math.max(0, Math.min(duration, (x / rect.width) * duration));

      if (isDragging === 'start') {
        const newStart = Math.min(newTime, trimEnd - 0.1); // Keep at least 0.1s
        setTrimStart(newStart);
      } else if (isDragging === 'end') {
        const newEnd = Math.max(newTime, trimStart + 0.1);
        setTrimEnd(newEnd);
      }
    },
    [isDragging, duration, trimStart, trimEnd]
  );

  const handleCanvasMouseUp = useCallback(() => {
    if (isDragging) {
      // Notify parent of trim change
      onTrimChange(trimStart, trimEnd);
      setIsDragging(null);
    }
  }, [isDragging, trimStart, trimEnd, onTrimChange]);

  const handlePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Start from trim start if at the end
      if (audioRef.current.currentTime >= trimEnd || audioRef.current.currentTime < trimStart) {
        audioRef.current.currentTime = trimStart;
      }
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleRestart = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = trimStart;
    setCurrentTime(trimStart);
    if (!isPlaying) {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      if (isMuted) {
        audioRef.current.volume = volume;
        setIsMuted(false);
      } else {
        audioRef.current.volume = 0;
        setIsMuted(true);
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  if (!sound) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Volume2 className="size-12 mx-auto mb-2 opacity-50" />
          <p>Select a sound to edit</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 bg-background">
      {/* Waveform */}
      <div
        ref={containerRef}
        className="flex-1 min-h-[200px] bg-muted/30 rounded-lg border overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          className={cn(
            'w-full h-full',
            isDragging ? 'cursor-ew-resize' : 'cursor-pointer'
          )}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
      </div>

      {/* Time display */}
      <div className="flex justify-between text-xs text-muted-foreground mt-2 px-1">
        <span>Trim: {formatTime(trimStart)}</span>
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        <span>End: {formatTime(trimEnd)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mt-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handleRestart}>
            <SkipBack className="size-4" />
          </Button>
          <Button size="icon" onClick={handlePlay}>
            {isPlaying ? (
              <Square className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </Button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="ghost" size="icon" onClick={toggleMute}>
            {isMuted ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </Button>
          <input
            type="range"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            min={0}
            max={1}
            step={0.01}
            className="w-24 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
          />
        </div>
      </div>

      {/* Trim info */}
      <div className="mt-4 p-3 bg-muted/30 rounded-lg border">
        <div className="text-xs font-medium mb-2">Trim Settings</div>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-muted-foreground">Start</div>
            <div className="font-mono">{formatTime(trimStart)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Duration</div>
            <div className="font-mono">{formatTime(trimEnd - trimStart)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">End</div>
            <div className="font-mono">{formatTime(trimEnd)}</div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Drag the colored handles on the waveform to trim the sound.
        </p>
      </div>
    </div>
  );
});

WaveformEditor.displayName = 'WaveformEditor';
