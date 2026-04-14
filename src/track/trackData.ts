import type * as THREE from 'three';
import type { BSpline } from '../util/bSpline';

export interface TrackData {
  spline: BSpline;
  /** Raw spline control points (NOT padded). 3 floats per point. */
  splinePoints: Float32Array;
  /** Number of original control points (= splinePoints.length / 3). */
  splinePointCount: number;
  /** Average abs-amplitude per chunk (no normalization). */
  rawIntensities: Float32Array;
  /** rawIntensities remapped to [0, 1] using its own min/max. */
  normalizedIntensities: Float32Array;
  /** Per-chunk slope (positive = downhill). */
  slopes: Float32Array;
  /** Per-chunk linear-light RGB (3 floats per chunk). */
  colors: Float32Array;
  /** Adjusted max slope used to derive `slopes` (scalar). */
  slopeIntensity: number;
  /** Built ribbon mesh. */
  mesh: THREE.BufferGeometry;
}
