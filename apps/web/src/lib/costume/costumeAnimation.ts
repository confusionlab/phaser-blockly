import type { AnimatedCostumeClip, AnimatedCostumePlayback, Costume } from '@/types';
import { isAnimatedCostume } from './costumeDocument';

export interface AnimatedCostumeSequenceFrame {
  frameIndex: number;
  isTerminal: boolean;
}

function sanitizeTotalFrames(totalFrames: number): number {
  if (!Number.isFinite(totalFrames)) {
    return 1;
  }
  return Math.max(1, Math.floor(totalFrames));
}

function sanitizeFps(fps: number): number {
  if (!Number.isFinite(fps)) {
    return 1;
  }
  return Math.max(1, fps);
}

export function getAnimatedCostumePlaybackSequence(
  totalFrames: number,
  playback: AnimatedCostumePlayback,
): AnimatedCostumeSequenceFrame[] {
  const normalizedTotalFrames = sanitizeTotalFrames(totalFrames);
  const frames = Array.from({ length: normalizedTotalFrames }, (_, index) => index);
  if (normalizedTotalFrames === 1) {
    return [{ frameIndex: 0, isTerminal: true }];
  }

  if (playback === 'ping-pong') {
    const pingPongFrames = [
      ...frames,
      ...frames.slice(1, -1).reverse(),
    ];
    return pingPongFrames.map((frameIndex, index) => ({
      frameIndex,
      isTerminal: index === pingPongFrames.length - 1,
    }));
  }

  return frames.map((frameIndex, index) => ({
    frameIndex,
    isTerminal: index === frames.length - 1,
  }));
}

export function getAnimatedCostumePreviewPlayback(playback: AnimatedCostumePlayback): AnimatedCostumePlayback {
  return playback === 'play-once' ? 'loop' : playback;
}

export function getAnimatedCostumePreviewFrameIndex(
  clip: AnimatedCostumeClip,
  nowMs: number,
): number {
  const sequence = getAnimatedCostumePlaybackSequence(
    clip.totalFrames,
    getAnimatedCostumePreviewPlayback(clip.playback),
  );
  if (sequence.length === 0) {
    return 0;
  }

  const frameDurationMs = 1000 / sanitizeFps(clip.fps);
  const normalizedNowMs = Math.max(0, Number.isFinite(nowMs) ? nowMs : 0);
  const sequenceIndex = Math.floor(normalizedNowMs / frameDurationMs) % sequence.length;
  return sequence[sequenceIndex]?.frameIndex ?? 0;
}

export function getCostumePreviewFrameIndex(
  costume: Costume,
  nowMs: number,
): number {
  if (!isAnimatedCostume(costume)) {
    return 0;
  }
  return getAnimatedCostumePreviewFrameIndex(costume.clip, nowMs);
}

export function getAnimatedCostumeFrameDurationMs(clip: AnimatedCostumeClip): number {
  return 1000 / sanitizeFps(clip.fps);
}
