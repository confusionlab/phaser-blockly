export interface WaveformData {
  peaks: number[];
  duration: number;
  peaksPerSecond: number;
}

const waveformCache = new Map<string, WaveformData>();

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

async function decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const context = getAudioContext();
  return await context.decodeAudioData(arrayBuffer.slice(0));
}

export async function decodeAudioSource(source: string): Promise<AudioBuffer> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to load audio source (${response.status})`);
  }
  return await decodeAudioData(await response.arrayBuffer());
}

export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  return await decodeAudioData(await blob.arrayBuffer());
}

function mixStereoToMono(audioBuffer: AudioBuffer): Float32Array {
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  const mono = new Float32Array(left.length);

  for (let index = 0; index < left.length; index += 1) {
    mono[index] = (left[index] + right[index]) / 2;
  }

  return mono;
}

function calculatePeaks(samples: Float32Array, sampleRate: number, peaksPerSecond: number): number[] {
  const peaksCount = Math.max(24, Math.ceil((samples.length / sampleRate) * peaksPerSecond));
  const samplesPerPeak = Math.max(1, Math.floor(samples.length / peaksCount));
  const peaks: number[] = [];

  for (let peakIndex = 0; peakIndex < peaksCount; peakIndex += 1) {
    const start = peakIndex * samplesPerPeak;
    const end = peakIndex === peaksCount - 1
      ? samples.length
      : Math.min(samples.length, start + samplesPerPeak);

    let max = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const amplitude = Math.abs(samples[sampleIndex]);
      if (amplitude > max) {
        max = amplitude;
      }
    }

    peaks.push(max);
  }

  const maxPeak = Math.max(...peaks, 0.01);
  return peaks.map((peak) => peak / maxPeak);
}

export function createWaveformFromAudioBuffer(
  audioBuffer: AudioBuffer,
  peaksPerSecond: number = 180,
): WaveformData {
  const samples = audioBuffer.numberOfChannels > 1
    ? mixStereoToMono(audioBuffer)
    : audioBuffer.getChannelData(0);

  return {
    peaks: calculatePeaks(samples, audioBuffer.sampleRate, peaksPerSecond),
    duration: audioBuffer.duration,
    peaksPerSecond,
  };
}

export async function generateWaveform(source: string): Promise<WaveformData> {
  const cached = waveformCache.get(source);
  if (cached) {
    return cached;
  }

  const waveform = createWaveformFromAudioBuffer(await decodeAudioSource(source));
  waveformCache.set(source, waveform);
  return waveform;
}

export function getCachedWaveform(source: string): WaveformData | null {
  return waveformCache.get(source) ?? null;
}

export async function generateWaveformFromBlob(blob: Blob, cacheKey?: string): Promise<WaveformData> {
  const key = cacheKey?.trim();
  if (key) {
    const cached = waveformCache.get(key);
    if (cached) {
      return cached;
    }
  }

  const waveform = createWaveformFromAudioBuffer(await decodeAudioBlob(blob));
  if (key) {
    waveformCache.set(key, waveform);
  }
  return waveform;
}

export function getVisiblePeaks(
  waveform: WaveformData,
  startSec: number,
  durationSec: number,
  targetBars: number,
): number[] {
  if (targetBars <= 0 || waveform.peaks.length === 0 || durationSec <= 0) {
    return [];
  }

  const sourcePeaks = waveform.peaks;
  const clampedStart = Math.max(0, Math.min(startSec * waveform.peaksPerSecond, sourcePeaks.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min((startSec + durationSec) * waveform.peaksPerSecond, sourcePeaks.length));
  const visiblePeakSpan = Math.max(clampedEnd - clampedStart, Number.EPSILON);
  const resampled: number[] = [];

  for (let barIndex = 0; barIndex < targetBars; barIndex += 1) {
    const barStart = clampedStart + (barIndex / targetBars) * visiblePeakSpan;
    const barEnd = clampedStart + ((barIndex + 1) / targetBars) * visiblePeakSpan;
    const sampleStart = Math.max(0, Math.min(Math.floor(barStart), sourcePeaks.length - 1));
    const sampleEnd = Math.max(sampleStart + 1, Math.min(Math.ceil(barEnd), sourcePeaks.length));
    let max = 0;

    for (let sourceIndex = sampleStart; sourceIndex < sampleEnd; sourceIndex += 1) {
      if (sourcePeaks[sourceIndex] > max) {
        max = sourcePeaks[sourceIndex];
      }
    }

    resampled.push(max);
  }

  return resampled;
}

export function clearWaveformCache(): void {
  waveformCache.clear();
}

export function formatAudioTime(seconds: number, showFraction: boolean = false): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);

  if (!showFraction) {
    return `${minutes}:${wholeSeconds.toString().padStart(2, '0')}`;
  }

  const hundredths = Math.floor((safeSeconds % 1) * 100);
  return `${minutes}:${wholeSeconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}
