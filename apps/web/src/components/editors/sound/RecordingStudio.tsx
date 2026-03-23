import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { blobToDataUrl } from '@/utils/convexHelpers';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import { formatAudioTime, generateWaveformFromBlob } from '@/lib/audioWaveform';
import type { Sound } from '@/types';
import { Check, Loader2, RotateCcw, Square } from 'lucide-react';
import { SoundClipEditor } from './SoundClipEditor';

interface RecordingStudioProps {
  onAddSound: (sound: Sound) => void;
}

type RecordingMode = 'idle' | 'recording' | 'review';

const RECORD_BUTTON_CLASS_NAME = 'size-16 rounded-full bg-red-500 text-white shadow-[0_18px_40px_rgba(239,68,68,0.26)] hover:bg-red-500/90';

function buildDefaultRecordingName(): string {
  return `Recording ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function RecordingStudio({ onAddSound }: RecordingStudioProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const [mode, setMode] = useState<RecordingMode>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingName, setRecordingName] = useState('');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl]);

  const resetReviewState = () => {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }

    setMode('idle');
    setRecordingDuration(0);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordingName('');
    setTrimStart(0);
    setTrimEnd(0);
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
        setRecordingName(buildDefaultRecordingName());

        try {
          const nextWaveform = await generateWaveformFromBlob(nextBlob, nextUrl);
          setRecordingDuration(nextWaveform.duration);
          setTrimStart(0);
          setTrimEnd(nextWaveform.duration);
        } catch (error) {
          console.error('Failed to prepare recorded waveform:', error);
          setErrorMessage('The recording finished, but its waveform could not be prepared.');
          setTrimStart(0);
          setTrimEnd(recordingDuration);
        }

        setMode('review');

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
        name: recordingName || buildDefaultRecordingName(),
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

  const reviewSound = useMemo<Sound | null>(() => {
    if (!recordedUrl || mode !== 'review') {
      return null;
    }

    return {
      id: 'draft-recording',
      name: recordingName || 'Recording',
      assetId: recordedUrl,
      duration: recordingDuration > 0 ? recordingDuration : undefined,
      trimStart: trimStart > 0.001 ? trimStart : undefined,
      trimEnd: trimEnd > 0.001 ? trimEnd : undefined,
    };
  }, [mode, recordedUrl, recordingDuration, recordingName, trimEnd, trimStart]);

  if (mode === 'review' && reviewSound) {
    return (
      <SoundClipEditor
        sound={reviewSound}
        onTrimChange={(nextStart, nextEnd) => {
          setTrimStart(nextStart);
          setTrimEnd(nextEnd);
        }}
        footer={
          <div className="flex flex-col gap-4">
            {errorMessage ? (
              <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-5 shadow-sm">
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {errorMessage}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-4 shadow-sm">
              <Button variant="outline" className="rounded-full" onClick={resetReviewState}>
                <RotateCcw className="size-4" />
                Re-record
              </Button>
              <Button className="rounded-full px-5" onClick={handleAdd} disabled={isSaving}>
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save
              </Button>
            </div>
          </div>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col gap-4 p-4 md:p-5">
      {errorMessage ? (
        <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-5 shadow-sm">
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        </div>
      ) : null}

      {mode === 'idle' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <Button
            size="icon"
            className={RECORD_BUTTON_CLASS_NAME}
            onClick={startRecording}
            title="Record"
          >
            <span className="size-5 rounded-full bg-current" />
          </Button>
          <div className="font-mono text-4xl font-semibold text-foreground">
            Press to record
          </div>
        </div>
      ) : null}

      {mode === 'recording' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <Button
            type="button"
            size="icon"
            onClick={stopRecording}
            className={RECORD_BUTTON_CLASS_NAME}
            title="Stop recording"
          >
            <Square className="size-6 fill-current" />
          </Button>
          <div className="font-mono text-4xl font-semibold text-foreground">
            {formatAudioTime(recordingDuration, true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
