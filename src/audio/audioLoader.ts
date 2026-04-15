export interface LoadedAudio {
  /** HTMLAudioElement bound to a blob URL — drives the playback clock. */
  element: HTMLAudioElement;
  /** Decoded buffer — authoritative source of sample data. */
  buffer: AudioBuffer;
  /**
   * Interleaved samples: `[L0, R0, L1, R1, …]` for stereo. Length =
   * `buffer.length × buffer.numberOfChannels`.
   *
   * Mono input is upcast to a 1-channel "interleaved" array (just the channel itself).
   *
   * NOTE: this layout is required for parity with the reference analysis.
   * The intensity/spectrum passes chunk the interleaved stream directly, and
   * `getBeatIndexes` factors `channels` into its skip math. Averaging to
   * mono would change every beat index.
   */
  samples: Float32Array;
  /** Free the blob URL when done. */
  dispose(): void;
}

let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export async function loadAudioFromFile(file: File): Promise<LoadedAudio> {
  const arrayBuffer = await file.arrayBuffer();
  return loadAudioFromArrayBuffer(arrayBuffer, file.type || 'audio/mpeg');
}

/**
 * Shared loader that takes already-fetched bytes. Used by `loadAudioFromFile`
 * (local files) and `loadAudioFromUrl` (Suno / direct URLs / blob URLs).
 */
export async function loadAudioFromArrayBuffer(
  arrayBuffer: ArrayBuffer,
  mimeType: string = 'audio/mpeg',
): Promise<LoadedAudio> {
  // decodeAudioData can detach the original buffer on some browsers; work on a
  // copy so the Blob below always has valid bytes.
  const decodeCopy = arrayBuffer.slice(0);
  const ctx = getAudioContext();
  const buffer = await ctx.decodeAudioData(decodeCopy);

  const samples = interleaveChannels(buffer);

  const blobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType }));
  const element = new Audio();
  element.src = blobUrl;
  element.preload = 'auto';
  element.crossOrigin = 'anonymous';

  await waitForCanPlay(element);

  return {
    element,
    buffer,
    samples,
    dispose: () => URL.revokeObjectURL(blobUrl),
  };
}

function interleaveChannels(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const out = new Float32Array(frames * channels);
  if (channels === 1) {
    out.set(buffer.getChannelData(0));
    return out;
  }
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  for (let i = 0; i < frames; i++) {
    const base = i * channels;
    for (let c = 0; c < channels; c++) {
      out[base + c] = data[c]![i]!;
    }
  }
  return out;
}

function waitForCanPlay(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (el.readyState >= 3) return resolve();
    const onReady = () => {
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('error', onError);
      reject(el.error ?? new Error('audio load failed'));
    };
    el.addEventListener('canplay', onReady);
    el.addEventListener('error', onError);
  });
}
