import * as THREE from 'three';
import type { BSpline } from '../util/bSpline';

/**
 * Straight "runway" strip behind the spline origin. Purely cosmetic — the
 * player starts at spline.p=0 with the camera behind them, and the real
 * track only extends forward, which makes the first frame look cut off
 * (black void beneath/behind the ship). This builds a flat ribbon matching
 * the track's width, start color, and start bitangent, extending backwards
 * along -tangent so the scene reads as "ship sitting on a runway about to
 * launch" rather than "ship hovering over nothing."
 *
 * Not part of the spline — block placement, scoring, and audio→p mapping
 * are untouched.
 *
 * UV convention matches `buildSplineMesh` so the same `TrackMaterial` draws
 * its edge-glow stripes (V≈0 and V≈1). Lane dashes run through too;
 * alignment with the first real-track dash is approximate but the junction
 * is behind the player at start so it's not scrutinised.
 */
export function buildRunwayMesh(
  spline: BSpline,
  length: number,
  halfThickness: number,
  bitangent: THREE.Vector3,
): THREE.BufferGeometry {
  const origin = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bt = new THREE.Vector3();
  const color = new THREE.Color();
  const desired = new THREE.Vector3().copy(bitangent);

  spline.getPointAt(0, origin);
  spline.getTangentAt(0, tangent);
  if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
  tangent.normalize();
  spline.getBitangentPerpendicularToTangent(0, desired, bt);
  spline.getColorAt(0, color);

  // Match buildSplineMesh's U normalization: U = vertex.x / lastV1x where
  // lastV1x = spline.getPointAt(1).x + bt.x*halfThickness. This keeps the
  // dashed lane markers on the runway at the same density and phase as the
  // first real-track segment, so there's no visible junction.
  const endPoint = new THREE.Vector3();
  const endBt = new THREE.Vector3();
  spline.getPointAt(1, endPoint);
  spline.getBitangentPerpendicularToTangent(1, new THREE.Vector3().copy(bitangent), endBt);
  const lastV1x = endPoint.x + endBt.x * halfThickness;
  const lastV2x = endPoint.x - endBt.x * halfThickness;
  const uDenom1 = lastV1x === 0 ? 1 : lastV1x;
  const uDenom2 = lastV2x === 0 ? 1 : lastV2x;

  // Back edge (far from player) and front edge (at spline origin, shared
  // with the real track's first vertex).
  const back = origin.clone().addScaledVector(tangent, -length);
  const front = origin.clone();

  const v1Back = back.clone().addScaledVector(bt, +halfThickness);
  const v2Back = back.clone().addScaledVector(bt, -halfThickness);
  const v1Front = front.clone().addScaledVector(bt, +halfThickness);
  const v2Front = front.clone().addScaledVector(bt, -halfThickness);

  const positions = new Float32Array([
    v1Back.x,  v1Back.y,  v1Back.z,
    v2Back.x,  v2Back.y,  v2Back.z,
    v1Front.x, v1Front.y, v1Front.z,
    v2Front.x, v2Front.y, v2Front.z,
  ]);
  const colors = new Float32Array([
    color.r, color.g, color.b,
    color.r, color.g, color.b,
    color.r, color.g, color.b,
    color.r, color.g, color.b,
  ]);
  // V: 1 on +bitangent edge, 0 on -bitangent edge (matches buildSplineMesh).
  // U normalized by the same divisor so dashes are continuous with the track.
  const uvs = new Float32Array([
    v1Back.x / uDenom1,  1,
    v2Back.x / uDenom2,  0,
    v1Front.x / uDenom1, 1,
    v2Front.x / uDenom2, 0,
  ]);
  // CCW winding to match buildSplineMesh's index convention (doubleSide
  // renders both sides, so this is correct but not strictly required).
  const indices = new Uint32Array([2, 1, 0, 3, 1, 2]);

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
