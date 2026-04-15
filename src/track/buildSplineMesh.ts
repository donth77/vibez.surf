import * as THREE from 'three';
import type { BSpline } from '../util/bSpline';

/**
 * Builds a vertex-colored ribbon along the spline. Defaults match
 * `TrackGenerator`: resolution 256, halfThickness 5, bitangent +Z (so the
 * ribbon lies flat in the X/Y/Z box with width along Z).
 *
 * Winding caveat (§4.6): three.js is right-handed (CCW front-face). We render
 * with `DoubleSide` so the ribbon is visible from above regardless of index
 * order.
 */
export function buildSplineMesh(
  spline: BSpline,
  resolution: number,
  halfThickness: number,
  bitangent: THREE.Vector3,
): THREE.BufferGeometry {
  // Loop: i=0 placed separately, then 1..resolution-1. The mesh therefore
  // stops at t=(resolution-1)/resolution, not t=1 — the t=1 vertex is
  // intentionally omitted (the spline is degenerate at t=1 because of the
  // endpoint-duplication trick).
  const tStep = 1 / resolution;
  const vertCount = resolution * 2;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = new Uint32Array((resolution - 1) * 6);

  const point = new THREE.Vector3();
  const bt = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const color = new THREE.Color();
  const desired = new THREE.Vector3().copy(bitangent);

  // U-coordinate normalisation constant — reads from t=1 even though the
  // mesh doesn't actually include that vertex. This is intentional; the
  // parity tests pin it.
  spline.getPointAt(1, point);
  spline.getBitangentPerpendicularToTangent(1, desired, bt);
  const lastV1x = point.x + bt.x * halfThickness;
  const lastV2x = point.x - bt.x * halfThickness;

  const writeStrip = (i: number, t: number) => {
    spline.getPointAt(t, point);
    spline.getBitangentPerpendicularToTangent(t, desired, bt);
    spline.getColorAt(t, color);

    v1.copy(point).addScaledVector(bt, halfThickness);
    v2.copy(point).addScaledVector(bt, -halfThickness);

    const o3 = i * 6;
    const o2 = i * 4;
    positions[o3] = v1.x;     positions[o3 + 1] = v1.y;     positions[o3 + 2] = v1.z;
    positions[o3 + 3] = v2.x; positions[o3 + 4] = v2.y;     positions[o3 + 5] = v2.z;

    colors[o3] = color.r;     colors[o3 + 1] = color.g;     colors[o3 + 2] = color.b;
    colors[o3 + 3] = color.r; colors[o3 + 4] = color.g;     colors[o3 + 5] = color.b;

    uvs[o2] = lastV1x === 0 ? 0 : v1.x / lastV1x;     uvs[o2 + 1] = 1;
    uvs[o2 + 2] = lastV2x === 0 ? 0 : v2.x / lastV2x; uvs[o2 + 3] = 0;

    if (i > 0) {
      const o = (i - 1) * 6;
      const a = (i - 1) * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      // Indices wound CCW for three.js right-handed front-face convention.
      // DoubleSide on the material makes this moot but keeps single-sided opt-in clean.
      indices[o]     = c;
      indices[o + 1] = b;
      indices[o + 2] = a;
      indices[o + 3] = d;
      indices[o + 4] = b;
      indices[o + 5] = c;
    }
  };

  writeStrip(0, 0);
  for (let i = 1; i < resolution; i++) writeStrip(i, tStep * i);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
