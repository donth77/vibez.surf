import * as THREE from 'three';
import { BSpline } from '../util/bSpline';
import { hsvToRgb } from '../util/color';
import { buildSplineMesh } from './buildSplineMesh';
import type { TrackData } from './trackData';

/**
 * Default track-generation parameters.
 */
export const TRACK_DEFAULTS = {
  // Bumped from the original default 256 to 1024 — the track-mesh polygons
  // approximate the smooth spline more closely, so blocks (which sample the
  // spline directly) don't visibly hover above the polygons at curvature
  // changes. Cheap on geometry; helps a lot visually.
  meshResolution: 1024,
  meshHalfThickness: 5,
  meshBitangent: new THREE.Vector3(0, 0, 1),
  slopeSmoothness: 0.925,
  minSlopeIntensity: 0.6,
  maxSlopeIntensity: 1.2,
  minSpeed: 0.3,
  maxSpeed: 3,

  // Horizontal sweep parameter.
  // Drives gentle left/right curves in Z using a more heavily-smoothed copy
  // of the intensity signal, so the track's horizontal arc evolves on a
  // longer timescale than its vertical bumps. Magnitudes kept modest so the
  // track never sweeps wide enough to break the lane/collision math (block
  // lanes remain at ±2.2 on world Z).
  horizontalSmoothness: 0.985,
  horizontalSlopeIntensity: 0.45,

  // Number of chunks at the start of the song over which both vertical and
  // horizontal slopes ramp from 0 → full. Gives the player a flat launch
  // ramp before the audio-driven curves kick in. 100 chunks ≈ 4–8 seconds
  // depending on song length (chunks = sampleRate·channels·duration/4096).
  startRampChunks: 100,
} as const;

/**
 * Generates a full `TrackData` (spline + ribbon mesh) from per-chunk audio
 * intensities. Intensities are computed against the interleaved sample buffer
 * per §4.1a.
 */
export function generateTrack(
  rawIntensities: Float32Array,
  opts: Partial<typeof TRACK_DEFAULTS> = {},
): TrackData {
  const o = { ...TRACK_DEFAULTS, ...opts };

  const normalizedIntensities = remapArray(rawIntensities, 0, 1);
  const slopeIntensity = computeSlopeIntensity(rawIntensities, o.minSlopeIntensity, o.maxSlopeIntensity);
  const slopes = computeSlopes(normalizedIntensities, slopeIntensity, o.slopeSmoothness);
  // Horizontal slopes use a MUCH heavier smoothing so they change on a
  // long timescale — the track sweeps gently side-to-side instead of
  // chattering beat-to-beat.
  const horizSlopes = computeSlopes(normalizedIntensities, o.horizontalSlopeIntensity, o.horizontalSmoothness);

  // Flat launch ramp — zero out slopes for the first `startRampChunks`
  // chunks, easing into the computed values via smoothstep. Without this
  // the track can plunge or bank at t=0 which feels abrupt.
  applyStartRamp(slopes, o.startRampChunks);
  applyStartRamp(horizSlopes, o.startRampChunks);

  const colors = computeColors(slopes, slopeIntensity);
  const splinePoints = computeSplinePoints(normalizedIntensities, slopes, horizSlopes, o.minSpeed, o.maxSpeed);
  const splinePointCount = splinePoints.length / 3;

  const spline = new BSpline();
  spline.setPoints(packTriples(splinePoints));
  spline.setColors(packTriples(colors));

  const mesh = buildSplineMesh(spline, o.meshResolution, o.meshHalfThickness, o.meshBitangent);

  return {
    spline,
    splinePoints,
    splinePointCount,
    rawIntensities,
    normalizedIntensities,
    slopes,
    colors,
    slopeIntensity,
    mesh,
  };
}

// ---------- helpers ----------

/**
 * Multiplies the first `rampChunks` entries of `slopes` by a smoothstep curve
 * from 0 → 1. Creates a flat launch section at the start of the track that
 * eases into the audio-driven slopes, avoiding an abrupt t=0 dive/bank.
 * Mutates in place.
 */
function applyStartRamp(slopes: Float32Array, rampChunks: number): void {
  const N = Math.min(rampChunks, slopes.length);
  if (N <= 0) return;
  for (let i = 0; i < N; i++) {
    const t = i / rampChunks;
    const smooth = t * t * (3 - 2 * t); // classic smoothstep
    slopes[i]! *= smooth;
  }
}

function remapArray(input: Float32Array, outMin: number, outMax: number): Float32Array {
  let inMin = Infinity;
  let inMax = -Infinity;
  for (let i = 0; i < input.length; i++) {
    const v = input[i]!;
    if (v < inMin) inMin = v;
    if (v > inMax) inMax = v;
  }
  const out = new Float32Array(input.length);
  const denom = inMax - inMin;
  if (denom === 0) {
    out.fill(outMin);
    return out;
  }
  const scale = (outMax - outMin) / denom;
  for (let i = 0; i < input.length; i++) {
    out[i] = outMin + (input[i]! - inMin) * scale;
  }
  return out;
}

function computeSlopeIntensity(rawIntensities: Float32Array, minS: number, maxS: number): number {
  let above = 0;
  for (let i = 0; i < rawIntensities.length; i++) if (rawIntensities[i]! > 0.5) above++;
  const audioAgitation = above / rawIntensities.length;
  return minS + (maxS - minS) * audioAgitation;
}

function computeSlopes(normalized: Float32Array, slopeIntensity: number, smoothness: number): Float32Array {
  const slopes = new Float32Array(normalized.length);
  slopes[0] = 0;
  const blend = 1 - smoothness;
  for (let i = 1; i < slopes.length; i++) {
    slopes[i] = slopes[i - 1]! + (normalized[i]! - slopes[i - 1]!) * blend;
  }
  // Then remap into [+slopeIntensity, -slopeIntensity] (note inverted range — intentional).
  return remapArray(slopes, slopeIntensity, -slopeIntensity);
}

function computeColors(slopes: Float32Array, slopeIntensity: number): Float32Array {
  const colors = new Float32Array(slopes.length * 3);
  const lo = -slopeIntensity;
  const hi = slopeIntensity;
  const denom = hi - lo;
  for (let i = 0; i < slopes.length; i++) {
    const t = denom === 0 ? 0 : (slopes[i]! - lo) / denom;
    let hue = -0.2 + (0.83 - -0.2) * t;
    if (hue < 0) hue = 0;
    else if (hue > 1) hue = 1;
    const [r, g, b] = hsvToRgb(hue, 1, 0.8);
    const o = i * 3;
    colors[o] = r;
    colors[o + 1] = g;
    colors[o + 2] = b;
  }
  return colors;
}

function computeSplinePoints(
  normalized: Float32Array,
  slopes: Float32Array,
  horizSlopes: Float32Array,
  minSpeed: number,
  maxSpeed: number,
): Float32Array {
  const out = new Float32Array(normalized.length * 3);
  let prevX = 0;
  let prevY = 0;
  let prevZ = 0;
  for (let i = 0; i < normalized.length; i++) {
    const speedInv = minSpeed + (maxSpeed - minSpeed) * normalized[i]!;
    const x = prevX + speedInv;
    const y = prevY + slopes[i]! * speedInv;
    const z = prevZ + horizSlopes[i]! * speedInv;
    const o = i * 3;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    prevX = x;
    prevY = y;
    prevZ = z;
  }
  return out;
}

function packTriples(flat: Float32Array): Array<readonly [number, number, number]> {
  const n = flat.length / 3;
  const out: Array<readonly [number, number, number]> = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    out[i] = [flat[o]!, flat[o + 1]!, flat[o + 2]!];
  }
  return out;
}
