import { describe, expect, it } from 'vitest';
import {
  fftMagnitudes,
  getBitReversalPermutation,
  getTruncatedBlackmanHarrisWindow,
  makeFftPlan,
} from '../../src/audio/fft';
import { getBeatIndexes, getIntensities } from '../../src/audio/audioAnalysis';

describe('FFT — internal sanity', () => {
  it('bit-reversal permutation is an involution', () => {
    const N = 1024;
    const p = getBitReversalPermutation(N);
    for (let i = 0; i < N; i++) expect(p[p[i]!]).toBe(i);
  });

  it('window has truncated-form shape: small endpoints, midpoint near one', () => {
    const N = 4096;
    const w = getTruncatedBlackmanHarrisWindow(N);
    // The 3-coefficient truncated form leaves a small offset at the endpoints
    // (~0.012 at N=4096) — this is expected; the canonical 4-term Blackman-Harris
    // would zero them. Don't "fix" by adding the a3 term.
    expect(w[0]!).toBeLessThan(0.02);
    expect(w[N - 1]!).toBeLessThan(0.02);
    expect(w[N >> 1]!).toBeGreaterThan(0.95);
    // Symmetric.
    expect(w[10]!).toBeCloseTo(w[N - 1 - 10]!, 6);
  });

  it('produces deterministic, finite output of correct length', () => {
    const N = 4096;
    const plan = makeFftPlan(N);
    const input1 = makeNoise(N, 1234);
    const input2 = new Float32Array(input1); // copy before fft mutates input1
    const out1 = new Float32Array(N);
    const out2 = new Float32Array(N);
    const sR = new Float32Array(N);
    const sI = new Float32Array(N);

    fftMagnitudes(plan, input1, out1, sR, sI);
    fftMagnitudes(plan, input2, out2, sR, sI);

    for (let i = 0; i < N; i++) {
      expect(Number.isFinite(out1[i]!)).toBe(true);
      expect(out1[i]).toBeCloseTo(out2[i]!, 6);
    }
  });
});

describe('Beat detection — guards', () => {
  it('returns [] on a silent spectrum (divide-by-zero guard, §4.2)', () => {
    const N = 4096;
    const silent = Array.from({ length: 100 }, () => new Float32Array(N));
    expect(getBeatIndexes(silent, 44100, 2, 20, 0.1, 0.5)).toEqual([]);
  });

  it('returns [] on empty spectrum', () => {
    expect(getBeatIndexes([], 44100, 2, 20, 0.1, 0.5)).toEqual([]);
  });
});

describe('Intensities', () => {
  it('matches the C# averaging formula on a known signal', () => {
    // Constant DC signal of amplitude 0.5 → every chunk's avg-abs = 0.5
    const N = 4096;
    const samples = new Float32Array(N * 4).fill(0.5);
    const intensities = getIntensities(samples, N);
    expect(intensities.length).toBe(4);
    for (const v of intensities) expect(v).toBeCloseTo(0.5, 6);
  });

  it('floors chunk count when samples don\'t divide evenly', () => {
    const samples = new Float32Array(4097);
    expect(getIntensities(samples, 4096).length).toBe(1);
  });
});

// TODO: §13 parity tests (require Unity-side dump). When available, add
//   tests/parity/__fixtures__/<song>.json with rawIntensities[0..9],
//   normalizedIntensities[0..9], slopes[0..9], slopeIntensity, colors[10/100],
//   splinePoints[0..4], lowBeatIndexes (full), highBeatIndexes (full),
//   totalTrackPoints — and assert against them.

function makeNoise(n: number, seed: number): Float32Array {
  // Simple LCG; deterministic across runs/platforms.
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s / 0xffffffff) * 2 - 1;
  }
  return out;
}
