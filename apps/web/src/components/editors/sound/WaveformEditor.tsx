import { memo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Sound } from '@/types';
import { Mic, Volume2 } from 'lucide-react';
import { SoundClipEditor } from './SoundClipEditor';

interface WaveformEditorProps {
  sound: Sound | null;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  onCreateRecording: () => void;
  footer?: ReactNode;
}

export const WaveformEditor = memo(({ sound, onTrimChange, onCreateRecording, footer }: WaveformEditorProps) => {
  if (!sound) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))] p-8 text-center shadow-sm">
          <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-[#efefef] text-[#5f5f5f]">
            <Volume2 className="size-11" />
          </div>
          <h3 className="mt-6 text-2xl font-semibold text-foreground">Select a sound</h3>
          <Button className="mt-8 rounded-full px-5" onClick={onCreateRecording}>
            <Mic className="size-4" />
            Record a New Sound
          </Button>
        </div>
      </div>
    );
  }

  return <SoundClipEditor sound={sound} onTrimChange={onTrimChange} footer={footer} />;
});

WaveformEditor.displayName = 'WaveformEditor';
