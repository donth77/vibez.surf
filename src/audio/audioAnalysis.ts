import { FftWorkerPool } from './workerPool';

/**
 * Computes one average intensity per `windowSize`-sample chunk. Operates on
 * the **interleaved** sample stream (see `audioLoader.ts` and §4.1a).
 *
 * Length = `Math.floor(samples.length / windowSize)`.
 */
export function getIntensities(samples: Float32Array, windowSize: number): Float32Array {
  const count = Math.floor(samples.length / windowSize);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const base = i * windowSize;
    let sum = 0;
    for (let j = 0; j < windowSize; j++) sum += Math.abs(samples[base + j]!);
    out[i] = sum / windowSize;
  }
  return out;
}

/**
 * Returns one magnitude spectrum (length `windowSize`) per chunk of the
 * interleaved sample stream. Runs FFT in the supplied worker pool.
 */
export async function getSpectrumAmplitudes(
  samples: Float32Array,
  windowSize: number,
  pool: FftWorkerPool,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array[]> {
  const count = Math.floor(samples.length / windowSize);
  const chunks: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const slice = new Float32Array(windowSize);
    slice.set(samples.subarray(i * windowSize, i * windowSize + windowSize));
    chunks[i] = slice;
  }
  return pool.run(chunks, onProgress);
}

/**
 * Finds beat indices in a given frequency band.
 *
 * Uses the chunk frequency-bin energy at the bin closest to `frequencyHz`,
 * normalised against the global peak for that bin, and emits an index whenever
 * the chunk-to-chunk delta exceeds `beatThreshold`. After a hit it skips
 * `sampleFrequency · audioChannels · skipSecondsIfBeatFound / windowSize` chunks.
 *
 * Returns indices into `spectrum` (i.e. chunk indices)
 */
export function getBeatIndexes(
  spectrum: Float32Array[],
  sampleFrequency: number,
  audioChannels: number,
  frequencyHz: number,
  beatThreshold: number,
  skipSecondsIfBeatFound: number,
): number[] {
  if (spectrum.length === 0) return [];
  const windowSize = spectrum[0]!.length;
  const frequencyIndex = Math.floor((windowSize / (20000 - 20)) * frequencyHz);
  if (frequencyIndex < 0 || frequencyIndex >= windowSize) return [];

  const skipSamplesIfBeatFound = Math.floor(
    (sampleFrequency * audioChannels * skipSecondsIfBeatFound) / windowSize,
  );

  let max = -Infinity;
  for (let i = 0; i < spectrum.length - 1; i++) {
    const v = spectrum[i]![frequencyIndex]!;
    if (v > max) max = v;
  }
  // Divide-by-zero guard (silent band) per §4.2 of PLAN.md.
  if (!isFinite(max) || max <= 0) return [];

  const indexes: number[] = [];
  for (let i = 0; i < spectrum.length - 1; i++) {
    const curr = spectrum[i]![frequencyIndex]! / max;
    const next = spectrum[i + 1]![frequencyIndex]! / max;
    if (next - curr >= beatThreshold) {
      indexes.push(i);
      i += Math.max(skipSamplesIfBeatFound, 1) - 1;
    }
  }
  return indexes;
}
