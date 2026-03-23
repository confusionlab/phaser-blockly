import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatAudioTime, generateWaveformFromBlob } from '@/lib/audioWaveform';
import { Square } from 'lucide-react';

interface RecordingStudioProps {
  onReviewRecording: (draft: {
    blob: Blob;
    url: string;
    name: string;
    duration?: number;
  }) => void;
}

type RecordingMode = 'idle' | 'recording';

const RECORD_BUTTON_CLASS_NAME = 'size-16 rounded-full bg-red-500 text-white shadow-[0_18px_40px_rgba(239,68,68,0.26)] hover:bg-red-500/90';

function buildDefaultRecordingName(): string {
  return `Recording ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function RecordingStudio({ onReviewRecording }: RecordingStudioProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const [mode, setMode] = useState<RecordingMode>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
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

        setRecordedUrl(nextUrl);

        let nextDuration: number | undefined;
        try {
          const nextWaveform = await generateWaveformFromBlob(nextBlob, nextUrl);
          nextDuration = nextWaveform.duration;
        } catch (error) {
          console.error('Failed to prepare recorded waveform:', error);
          setErrorMessage('The recording finished, but its waveform could not be prepared.');
        }

        onReviewRecording({
          blob: nextBlob,
          url: nextUrl,
          name: buildDefaultRecordingName(),
          duration: nextDuration,
        });

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
          <div className="text-2xl font-medium text-foreground">
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
          <div className="text-2xl font-medium text-foreground">
            {formatAudioTime(recordingDuration, true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
