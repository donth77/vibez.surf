import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BSpline } from '../../src/util/bSpline';

describe('BSpline — endpoint interpolation trick', () => {
  it('passes through the first input control point at t=0', () => {
    const spline = new BSpline();
    const points: Array<readonly [number, number, number]> = [
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 2, 0],
      [4, 0, 0],
    ];
    spline.setPoints(points);
    spline.setColors(points.map(() => [1, 1, 1]));

    const first = spline.getPointAt(0, new THREE.Vector3());
    expect(first.x).toBeCloseTo(0, 5);
    expect(first.y).toBeCloseTo(0, 5);
    // Note: t=1 is intentionally NOT tested. The  duplicate-endpoint trick
    // makes t=0 land on the first input point, but t=1 is degenerate (reads
    // padded indices that mix the last input with its duplicates) and does NOT
    // return the last input point. The mesh builder respects this by stopping
    // at t=(resolution-1)/resolution.
  });

  it('tangent points along the segment direction at an interior t', () => {
    const spline = new BSpline();
    const pts: Array<readonly [number, number, number]> = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ];
    spline.setPoints(pts);
    spline.setColors(pts.map(() => [1, 1, 1]));
    // At t=0 the tangent is degenerate (zero) due to padded duplicates — that's
    // a property of the source we mirror. Test at t=0.5 instead.
    const tangent = spline.getTangentAt(0.5, new THREE.Vector3()).normalize();
    expect(tangent.x).toBeGreaterThan(0.99);
    expect(Math.abs(tangent.y)).toBeLessThan(1e-5);
  });

  it('bitangent perpendicular to tangent stays in the requested half-space', () => {
    const spline = new BSpline();
    const pts: Array<readonly [number, number, number]> = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ];
    spline.setPoints(pts);
    spline.setColors(pts.map(() => [1, 1, 1]));
    // At t=0 the tangent is zero (degenerate) — Unity's Vector3.Project handles
    // this by returning the desired direction unchanged. Mirror that.
    const bt0 = spline.getBitangentPerpendicularToTangent(0, new THREE.Vector3(0, 0, 1), new THREE.Vector3());
    expect(bt0.z).toBeCloseTo(1, 5);

    const bt = spline.getBitangentPerpendicularToTangent(0.5, new THREE.Vector3(0, 0, 1), new THREE.Vector3());
    expect(bt.z).toBeCloseTo(1, 5);
    expect(Math.abs(bt.x)).toBeLessThan(1e-5);
  });

  it('color lerp at t=0 matches the first color', () => {
    const spline = new BSpline();
    const pts: Array<readonly [number, number, number]> = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ];
    spline.setPoints(pts);
    spline.setColors([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const c = spline.getColorAt(0, new THREE.Color());
    expect(c.r).toBeCloseTo(1, 5);
    expect(c.g).toBeCloseTo(0, 5);
    expect(c.b).toBeCloseTo(0, 5);
  });
});
