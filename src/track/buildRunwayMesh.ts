import * as THREE from 'three';
import type { BSpline } from '../util/bSpline';

/**
 * Straight "runway" strip attached to either end of the spline. Purely
 * cosmetic — the spline only covers the song's duration, but we want:
 *
 *   - A visible ramp BEHIND the spline origin during pre-roll (ship
 *     cruises in before audio starts).
 *   - A visible extension AFTER the spline endpoint during post-roll (ship
 *     continues cruising into the distance after audio ends, before the
 *     end-song panel pops up).
 *
 * Not part of the spline — block placement, scoring, and audio→p mapping
 * are untouched.
 *
 * UV convention matches `buildSplineMesh` so the same `TrackMaterial` draws
 * its edge-glow stripes (V≈0 and V≈1). Lane dashes run through too; the
 * junction is always behind / in front of the player at the relevant
 * moment so minor dash-alignment drift isn't scrutinised.
 *
 * @param atEnd  false = attach behind origin (pre-roll runway),
 *               true  = attach after endpoint (post-roll extension).
 */
export function buildRunwayMesh(
  spline: BSpline,
  length: number,
  halfThickness: number,
  bitangent: THREE.Vector3,
  atEnd: boolean = false,
): THREE.BufferGeometry {
  const anchor = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bt = new THREE.Vector3();
  const color = new THREE.Color();
  const desired = new THREE.Vector3().copy(bitangent);

  // Sample at whichever end we're attaching to. For the post-roll join
  // we sample at the exact `t` where `buildSplineMesh` stops drawing
  // ((resolution-1)/resolution with its default 1024), so the runway's
  // anchor edge sits on top of the track mesh's last cross-section and
  // there's no visible seam on the side glow / lane dashes. t=1 itself
  // is degenerate (duplicated endpoint) so we don't go past this.
  const sampleT = atEnd ? 1023 / 1024 : 0;
  spline.getPointAt(sampleT, anchor);
  spline.getTangentAt(sampleT, tangent);
  if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
  tangent.normalize();
  spline.getBitangentPerpendicularToTangent(sampleT, desired, bt);
  spline.getColorAt(sampleT, color);

  // Match buildSplineMesh's U normalization: U = vertex.x / lastV1x where
  // lastV1x = spline.getPointAt(1).x + bt.x*halfThickness. Keeps the lane
  // dashes at the same density and phase as the real track.
  const endPoint = new THREE.Vector3();
  const endBt = new THREE.Vector3();
  spline.getPointAt(1, endPoint);
  spline.getBitangentPerpendicularToTangent(1, new THREE.Vector3().copy(bitangent), endBt);
  const lastV1x = endPoint.x + endBt.x * halfThickness;
  const lastV2x = endPoint.x - endBt.x * halfThickness;
  const uDenom1 = lastV1x === 0 ? 1 : lastV1x;
  const uDenom2 = lastV2x === 0 ? 1 : lastV2x;

  // Anchor edge (joins to the real track) and far edge (away from track).
  // For atEnd=true, "far" is forward along +tangent; otherwise backward
  // along -tangent (pre-roll, ship cruises toward origin).
  const dir = atEnd ? 1 : -1;
  const far = anchor.clone().addScaledVector(tangent, dir * length);
  const near = anchor.clone();

  // Keep vertex ordering "back → front" consistent with the pre-roll
  // build so the indexed triangles stay correctly wound. For post-roll,
  // `back` holds the far (forward) vertices and `front` holds the anchor.
  const back = atEnd ? near : far;
  const front = atEnd ? far : near;

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
