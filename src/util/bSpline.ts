import * as THREE from 'three';

/**
 * Cubic uniform B-spline (matrix form, 1/6 multiplier). The first and last
 * control points are duplicated twice so the spline interpolates them.
 *
 * Coordinates: X is track progression, Y is vertical, Z is across-track
 * (left/right lanes).
 */

const B_SPLINE_MULTIPLIER = 1 / 6;

// Row-major flattened 4×4 cubic uniform B-spline basis matrix.
//   [ 1, 4, 1, 0 ]
//   [-3, 0, 3, 0 ]
//   [ 3,-6, 3, 0 ]
//   [-1, 3,-3, 1 ]
const B_SPLINE_MATRIX: readonly number[] = [
  1, 4, 1, 0,
  -3, 0, 3, 0,
  3, -6, 3, 0,
  -1, 3, -3, 1,
];

export interface SubSplineIndex {
  /** Index of the first of the four control points for this sub-spline. */
  firstSubSplinePointIndex: number;
  /** Position within the sub-spline, in [0, 1). */
  subSplineInterpolator: number;
}

export class BSpline {
  /** Padded control points (first/last duplicated). 3 floats per point. */
  private points: Float32Array = new Float32Array(0);
  /** Padded vertex colors. 3 floats per point (linear-light RGB). */
  private colors: Float32Array = new Float32Array(0);
  /** Number of padded control points (= original length + 4). */
  private pointCount = 0;

  setPoints(points: ReadonlyArray<readonly [number, number, number]>): void {
    this.pointCount = points.length + 4;
    this.points = new Float32Array(this.pointCount * 3);
    // Duplicate first twice at head, last twice at tail.
    const first = points[0]!;
    const last = points[points.length - 1]!;
    this.writePoint(0, first);
    this.writePoint(1, first);
    for (let i = 0; i < points.length; i++) this.writePoint(2 + i, points[i]!);
    this.writePoint(2 + points.length, last);
    this.writePoint(3 + points.length, last);
  }

  setColors(colors: ReadonlyArray<readonly [number, number, number]>): void {
    if (colors.length + 4 !== this.pointCount) {
      throw new Error(`color count ${colors.length} mismatch with point count ${this.pointCount - 4}`);
    }
    this.colors = new Float32Array(this.pointCount * 3);
    const first = colors[0]!;
    const last = colors[colors.length - 1]!;
    this.writeColor(0, first);
    this.writeColor(1, first);
    for (let i = 0; i < colors.length; i++) this.writeColor(2 + i, colors[i]!);
    this.writeColor(2 + colors.length, last);
    this.writeColor(3 + colors.length, last);
  }

  /** Number of sub-splines = padded point count − 4. */
  private get subSplineCount(): number {
    return this.pointCount - 4;
  }

  getSubSplineIndexes(t: number): SubSplineIndex {
    const lerp = t * this.subSplineCount;
    const firstSubSplinePointIndex = Math.floor(lerp);
    const subSplineInterpolator = lerp - firstSubSplinePointIndex;
    return { firstSubSplinePointIndex, subSplineInterpolator };
  }

  /** Position on the spline at percentage `t ∈ [0, 1]`. Writes to `out`. */
  getPointAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    const { firstSubSplinePointIndex, subSplineInterpolator } = this.getSubSplineIndexes(t);
    return this.evalAt(firstSubSplinePointIndex, subSplineInterpolator, [1, subSplineInterpolator, subSplineInterpolator * subSplineInterpolator, subSplineInterpolator ** 3], out);
  }

  /** Tangent on the spline at `t`. Writes to `out`. */
  getTangentAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    const { firstSubSplinePointIndex, subSplineInterpolator } = this.getSubSplineIndexes(t);
    return this.evalAt(firstSubSplinePointIndex, subSplineInterpolator, [0, 1, 2 * subSplineInterpolator, 3 * subSplineInterpolator * subSplineInterpolator], out);
  }

  /** Linear color interpolation between adjacent control points. Writes to `out`. */
  getColorAt(t: number, out: THREE.Color): THREE.Color {
    const { firstSubSplinePointIndex, subSplineInterpolator } = this.getSubSplineIndexes(t);
    const i = firstSubSplinePointIndex * 3;
    const j = (firstSubSplinePointIndex + 1) * 3;
    const u = subSplineInterpolator;
    out.r = this.colors[i]! * (1 - u) + this.colors[j]! * u;
    out.g = this.colors[i + 1]! * (1 - u) + this.colors[j + 1]! * u;
    out.b = this.colors[i + 2]! * (1 - u) + this.colors[j + 2]! * u;
    return out;
  }

  /**
   * Bitangent perpendicular to the tangent at `t`, pointed as close to
   * `desired` as possible. Writes to `out`.
   *
   * Takes the desired direction, subtracts its projection onto the tangent,
   * normalises.
   */
  getBitangentPerpendicularToTangent(t: number, desired: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const tangent = this.getTangentAt(t, _vec3a).normalize();
    const desiredN = _vec3b.copy(desired).normalize();
    const projLen = desiredN.dot(tangent);
    out.copy(desiredN).addScaledVector(tangent, -projLen).normalize();
    return out;
  }

  /** Number of original (unpadded) control points. */
  get originalPointCount(): number {
    return this.pointCount - 4;
  }

  /** Direct read access to the padded control point at the given padded index. */
  readPaddedPoint(paddedIndex: number, out: THREE.Vector3): THREE.Vector3 {
    const o = paddedIndex * 3;
    return out.set(this.points[o]!, this.points[o + 1]!, this.points[o + 2]!);
  }

  // --- internals ---

  private writePoint(i: number, p: readonly [number, number, number]): void {
    const o = i * 3;
    this.points[o] = p[0];
    this.points[o + 1] = p[1];
    this.points[o + 2] = p[2];
  }

  private writeColor(i: number, c: readonly [number, number, number]): void {
    const o = i * 3;
    this.colors[o] = c[0];
    this.colors[o + 1] = c[1];
    this.colors[o + 2] = c[2];
  }

  /**
   * Evaluates `[i0 i1 i2 i3] · BSplineMatrix · [P0; P1; P2; P3] · (1/6)`.
   * `interpolators` is the 1×4 vector (point or tangent basis). `pIndex` is the
   * starting padded point index.
   */
  private evalAt(pIndex: number, _u: number, interpolators: [number, number, number, number], out: THREE.Vector3): THREE.Vector3 {
    // mid = BSplineMatrix · subSplinePointsMatrix  (4×4 · 4×3 = 4×3)
    const mid: number[] = new Array(12);
    const M = B_SPLINE_MATRIX;
    const pBase = pIndex * 3;
    const P = this.points;
    for (let row = 0; row < 4; row++) {
      const r0 = M[row * 4]!;
      const r1 = M[row * 4 + 1]!;
      const r2 = M[row * 4 + 2]!;
      const r3 = M[row * 4 + 3]!;
      for (let col = 0; col < 3; col++) {
        mid[row * 3 + col] =
          r0 * P[pBase + col]! +
          r1 * P[pBase + 3 + col]! +
          r2 * P[pBase + 6 + col]! +
          r3 * P[pBase + 9 + col]!;
      }
    }
    // out = interpolators · mid  (1×4 · 4×3 = 1×3) · (1/6)
    let x = 0, y = 0, z = 0;
    for (let row = 0; row < 4; row++) {
      const w = interpolators[row]!;
      x += w * mid[row * 3]!;
      y += w * mid[row * 3 + 1]!;
      z += w * mid[row * 3 + 2]!;
    }
    return out.set(x * B_SPLINE_MULTIPLIER, y * B_SPLINE_MULTIPLIER, z * B_SPLINE_MULTIPLIER);
  }
}

const _vec3a = new THREE.Vector3();
const _vec3b = new THREE.Vector3();
