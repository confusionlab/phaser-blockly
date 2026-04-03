import { expect, test } from '@playwright/test';
import { getVisiblePeaks } from '../src/lib/audioWaveform';

test.describe('audio waveform sampling', () => {
  test('upsamples short visible ranges to the requested fixed bar count', () => {
    const bars = getVisiblePeaks(
      {
        peaks: [0.2, 0.8, 0.4],
        duration: 1,
        peaksPerSecond: 3,
      },
      0,
      1,
      6,
    );

    expect(bars).toEqual([0.2, 0.2, 0.8, 0.8, 0.4, 0.4]);
  });

  test('downsamples wider visible ranges by preserving the strongest peak in each bar window', () => {
    const bars = getVisiblePeaks(
      {
        peaks: [0.1, 0.8, 0.3, 0.6],
        duration: 1,
        peaksPerSecond: 4,
      },
      0,
      1,
      2,
    );

    expect(bars).toEqual([0.8, 0.6]);
  });
});
