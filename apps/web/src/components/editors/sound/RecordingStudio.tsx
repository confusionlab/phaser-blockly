import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { blobToDataUrl } from '@/utils/convexHelpers';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import { formatAudioTime, generateWaveformFromBlob, type WaveformData } from '@/lib/audioWaveform';
import { WaveformViewport } from './WaveformViewport';
import type { Sound } from '@/types';
import { Check, Loader2, Mic, Play, Square, Trash2 } from 'lucide-react';

interface RecordingStudioProps {
  onAddSound: (sound: Sound) => void;
  onCancel: () => void;
}

type RecordingMode = 'idle' | 'recording' | 'review';

function buildDefaultRecordingName(): string {
  return `Recording ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function RecordingStudio({ onAddSound, onCancel }: RecordingStudioProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);
  const disposedRef = useRef(false);

  const [mode, setMode] = useState<RecordingMode>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [name, setName] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  const clipDuration = useMemo(() => Math.max(0, trimEnd - trimStart), [trimEnd, trimStart]);

  useEffect(() => {
    disposedRef.current = false;

    return () => {
      disposedRef.current = true;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }

      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }

      previewAudioRef.current?.pause();
      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl]);

  const resetReviewState = () => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setIsPreviewing(false);

    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }

    setMode('idle');
    setRecordingDuration(0);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setWaveform(null);
    setTrimStart(0);
    setTrimEnd(0);
    setCurrentTime(0);
    setName('');
    setErrorMessage(null);
  };

  const stopRecordingTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async () => {
    if (typeof MediaRecorder === 'undefined') {
      setErrorMessage('This browser does not support microphone recording.');
      return;
    }

    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blobType = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
        const nextBlob = new Blob(chunksRef.current, { type: blobType });
        const nextUrl = URL.createObjectURL(nextBlob);

        if (disposedRef.current) {
          URL.revokeObjectURL(nextUrl);
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          return;
        }

        setRecordedBlob(nextBlob);
        setRecordedUrl(nextUrl);
        setName(buildDefaultRecordingName());
        setCurrentTime(0);
        setMode('review');
        setIsPreparing(true);

        try {
          const nextWaveform = await generateWaveformFromBlob(nextBlob, nextUrl);
          setWaveform(nextWaveform);
          setRecordingDuration(nextWaveform.duration);
          setTrimStart(0);
          setTrimEnd(nextWaveform.duration);
        } catch (error) {
          console.error('Failed to prepare recorded waveform:', error);
          setErrorMessage('The recording finished, but its waveform could not be prepared.');
        } finally {
          setIsPreparing(false);
        }

        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };

      recorder.start();
      setMode('recording');
      const startedAt = Date.now();
      setRecordingDuration(0);
      timerRef.current = window.setInterval(() => {
        setRecordingDuration((Date.now() - startedAt) / 1000);
      }, 100);
    } catch (error) {
      console.error('Failed to start microphone capture:', error);
      setErrorMessage('Microphone access was blocked. Check browser permissions and try again.');
    }
  };

  const stopRecording = () => {
    stopRecordingTimer();
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const togglePreview = () => {
    if (!recordedUrl) {
      return;
    }

    if (isPreviewing) {
      previewAudioRef.current?.pause();
      setIsPreviewing(false);
      return;
    }

    previewAudioRef.current?.pause();

    const previewAudio = new Audio(recordedUrl);
    const previewStart = currentTime >= trimStartRef.current && currentTime < trimEndRef.current
      ? currentTime
      : trimStartRef.current;
    previewAudio.currentTime = previewStart;
    previewAudio.ontimeupdate = () => {
      setCurrentTime(previewAudio.currentTime);
      if (previewAudio.currentTime >= trimEndRef.current) {
        previewAudio.pause();
        previewAudio.currentTime = trimStartRef.current;
        setCurrentTime(trimStartRef.current);
        setIsPreviewing(false);
      }
    };
    previewAudio.onended = () => {
      setCurrentTime(trimStartRef.current);
      setIsPreviewing(false);
    };

    void previewAudio.play().catch((error) => {
      console.error('Failed to preview recording:', error);
      setErrorMessage('Preview playback failed. Try again.');
      setIsPreviewing(false);
    });

    previewAudioRef.current = previewAudio;
    setCurrentTime(previewStart);
    setIsPreviewing(true);
  };

  const handleAdd = async () => {
    if (!recordedBlob) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const rawDataUrl = await blobToDataUrl(recordedBlob);
      const normalizedDataUrl = recordedBlob.type.includes('webm')
        ? rawDataUrl
        : await compressAudio(rawDataUrl);
      const resolvedDuration = await getAudioDuration(normalizedDataUrl) ?? recordingDuration;

      const normalizedTrimStart = trimStart > 0.001 ? trimStart : undefined;
      const normalizedTrimEnd = trimEnd < resolvedDuration - 0.001 ? trimEnd : undefined;

      onAddSound({
        id: crypto.randomUUID(),
        name: name.trim() || buildDefaultRecordingName(),
        assetId: normalizedDataUrl,
        duration: resolvedDuration,
        trimStart: normalizedTrimStart,
        trimEnd: normalizedTrimEnd,
      });

      resetReviewState();
    } catch (error) {
      console.error('Failed to add recording to project:', error);
      setErrorMessage('The recording could not be added to the project.');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!isPreviewing || !previewAudioRef.current) {
      return;
    }

    const previewAudio = previewAudioRef.current;
    if (previewAudio.currentTime < trimStart || previewAudio.currentTime > trimEnd) {
      previewAudio.currentTime = trimStart;
      setCurrentTime(trimStart);
    }
  }, [isPreviewing, trimEnd, trimStart]);

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-5">
      <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>Back to sounds</Button>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}
      </div>

      {mode === 'idle' ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-[linear-gradient(180deg,rgba(247,247,247,1),rgba(239,239,239,0.98))] p-8 text-center shadow-sm">
            <div className="mx-auto flex size-28 items-center justify-center rounded-full border border-black/10 bg-[radial-gradient(circle_at_top,rgba(150,150,150,0.28),rgba(78,78,78,0.95))] text-white shadow-[0_18px_40px_rgba(64,64,64,0.22)]">
              <Mic className="size-11" />
            </div>
            <h3 className="mt-6 text-2xl font-semibold text-foreground">Ready to record</h3>
            <Button className="mt-8 h-12 rounded-full px-6 text-base" onClick={startRecording}>
              <Mic className="size-4" />
              Start Recording
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'recording' ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,250,250,0.98),rgba(248,242,242,0.96))] p-8 text-center shadow-sm">
            <div className="relative mx-auto flex size-28 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-red-500/15 animate-ping" />
              <button
                type="button"
                onClick={stopRecording}
                className="relative flex size-28 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_18px_40px_rgba(239,68,68,0.26)] transition-transform hover:scale-[1.02]"
              >
                <Square className="size-10 fill-current" />
              </button>
            </div>
            <div className="mt-2 font-mono text-4xl font-semibold text-foreground">
              {formatAudioTime(recordingDuration, true)}
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'review' ? (
        <div className="flex flex-1 flex-col gap-4 min-h-0">
          <div className="rounded-[28px] border border-border/70 bg-card/90 p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name this recording"
                className="h-11 max-w-sm rounded-2xl border-border/70 bg-background"
              />
              <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                {formatAudioTime(recordingDuration, true)}
              </div>
              <div className="rounded-full bg-[#efefef] px-3 py-1 text-xs font-medium text-[#5f5f5f]">
                {formatAudioTime(clipDuration, true)}
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 rounded-[28px] border border-border/70 bg-background/95 p-4 shadow-sm">
            <WaveformViewport
              waveform={waveform}
              duration={recordingDuration}
              currentTime={currentTime}
              trimStart={trimStart}
              trimEnd={trimEnd}
              onSeek={(nextTime) => {
                previewAudioRef.current?.pause();
                setIsPreviewing(false);
                const clamped = Math.max(trimStart, Math.min(trimEnd, nextTime));
                if (previewAudioRef.current) {
                  previewAudioRef.current.currentTime = clamped;
                }
                setCurrentTime(clamped);
              }}
              onTrimCommit={(nextStart, nextEnd) => {
                setTrimStart(nextStart);
                setTrimEnd(nextEnd);
              }}
              className={cn(isPreparing && 'opacity-70')}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-3 py-1">Start {formatAudioTime(trimStart, true)}</span>
              <span className="rounded-full bg-muted px-3 py-1">End {formatAudioTime(trimEnd, true)}</span>
              <span className="rounded-full bg-muted px-3 py-1">Playhead {formatAudioTime(currentTime, true)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="rounded-full" onClick={resetReviewState}>
                <Trash2 className="size-4" />
                Discard
              </Button>
              <Button variant="outline" className="rounded-full" onClick={togglePreview} disabled={isPreparing}>
                {isPreviewing ? <Square className="size-4" /> : <Play className="size-4" />}
                {isPreviewing ? 'Stop Preview' : 'Preview Clip'}
              </Button>
            </div>
            <Button className="rounded-full px-5" onClick={handleAdd} disabled={isSaving || isPreparing}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Add to Sounds
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
