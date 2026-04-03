import { memo, type ReactNode } from 'react';
import type { Sound } from '@/types';
import { SoundClipEditor } from './SoundClipEditor';

interface WaveformEditorProps {
  sound: Sound | null;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  footer?: ReactNode;
}

export const WaveformEditor = memo(({ sound, onTrimChange, footer }: WaveformEditorProps) => {
  if (!sound) {
    return null;
  }

  return <SoundClipEditor sound={sound} onTrimChange={onTrimChange} footer={footer} />;
});

WaveformEditor.displayName = 'WaveformEditor';
