/**
 * Audio processing utilities for compression and format conversion
 */

// Target settings for compressed audio
const TARGET_SAMPLE_RATE = 44100; // 44.1kHz is standard, good quality
const TARGET_BITRATE = 128000; // 128kbps for reasonable quality

/**
 * Compress audio to a more efficient format (WebM/Opus or fallback to WAV)
 * @param dataUrl - Original audio as data URL
 * @returns Compressed audio as data URL
 */
export async function compressAudio(dataUrl: string): Promise<string> {
  try {
    // Decode the original audio
    const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    const response = await fetch(dataUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Convert to mono if stereo (reduces size by half)
    const monoBuffer = convertToMono(audioContext, audioBuffer);

    // Try to encode with MediaRecorder (WebM/Opus) for best compression
    const compressed = await encodeWithMediaRecorder(monoBuffer, audioContext.sampleRate);
    if (compressed) {
      audioContext.close();
      return compressed;
    }

    // Fallback: encode as compressed WAV
    const wavDataUrl = await encodeAsWav(monoBuffer, audioContext.sampleRate);
    audioContext.close();
    return wavDataUrl;
  } catch (error) {
    console.error('Audio compression failed, using original:', error);
    return dataUrl; // Return original if compression fails
  }
}

/**
 * Convert stereo audio to mono
 */
function convertToMono(ctx: AudioContext, buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels === 1) {
    return buffer;
  }

  const monoBuffer = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
  const monoData = monoBuffer.getChannelData(0);

  // Average all channels
  for (let i = 0; i < buffer.length; i++) {
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      sum += buffer.getChannelData(channel)[i];
    }
    monoData[i] = sum / buffer.numberOfChannels;
  }

  return monoBuffer;
}

/**
 * Encode audio using MediaRecorder API (WebM/Opus format)
 * Returns null if not supported
 */
async function encodeWithMediaRecorder(
  buffer: AudioBuffer,
  sampleRate: number
): Promise<string | null> {
  // Check if MediaRecorder supports webm/opus
  if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      // Create an offline context to render the audio
      const offlineCtx = new OfflineAudioContext(1, buffer.length, sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(offlineCtx.destination);
      source.start();

      offlineCtx.startRendering().then((renderedBuffer) => {
        // Create a MediaStreamDestination
        const ctx = new AudioContext({ sampleRate });
        const dest = ctx.createMediaStreamDestination();
        const bufferSource = ctx.createBufferSource();
        bufferSource.buffer = renderedBuffer;
        bufferSource.connect(dest);

        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(dest.stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: TARGET_BITRATE,
        });

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        recorder.onstop = async () => {
          ctx.close();
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const dataUrl = await blobToDataUrl(blob);
          resolve(dataUrl);
        };

        recorder.onerror = () => {
          ctx.close();
          resolve(null);
        };

        recorder.start();
        bufferSource.start();

        // Stop recording when audio ends
        bufferSource.onended = () => {
          setTimeout(() => recorder.stop(), 100); // Small delay to capture all data
        };
      }).catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Encode audio as WAV (fallback, less compression but universal support)
 */
async function encodeAsWav(buffer: AudioBuffer, sampleRate: number): Promise<string> {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length * numChannels * 2; // 16-bit samples
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  // Write audio data
  const channelData = buffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
  return blobToDataUrl(blob);
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Get audio duration from a data URL
 */
export function getAudioDuration(dataUrl: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => resolve(undefined);
    audio.src = dataUrl;
  });
}
