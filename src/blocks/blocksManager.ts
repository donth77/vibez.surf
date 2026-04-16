import * as THREE from 'three';
import type { TrackData } from '../track/trackData';
import { createBlockMaterial, type BlockMaterial } from './blockMaterial';

/**
 * Block lanes, placement, and per-frame slide-in animation.
 *
 * Responsibilities:
 *  - Determine block lanes from beat indices using the deterministic-noise
 *    rule (§4.8). Discards high beats within ±5 of any low beat.
 *  - Holds a single `InstancedMesh` of all blocks. Block geometry:
 *    BoxGeometry(1.75, 0.35, 0.75) with Y offset 0.25 (authored).
 *  - Per-frame, walks each block and writes its instance matrix, lerping
 *    between adjacent raw spline points.
 *  - Per-instance `aPickedAt` attribute is created here so the M7 pickup
 *    handler can flip an entry from -1 to "now" without touching geometry.
 *
 * Coordinate system: block lateral position is along world Z (+Z forward).
 * With the spline laid in XY, world Z is also the player's bitangent
 * direction at almost every point, so the "lanes" line up with player input.
 */

export const BLOCKS_DEFAULTS = {
  /** Lateral distance from the track centerline to the outer lanes. */
  maxDistanceFromCenter: 2.2,
  /** Block dimensions (width × height × depth). */
  blockSize: new THREE.Vector3(1.75, 0.35, 0.75),
  /**
   * The authored renderer is offset +0.25 Y from the collider root, but we
   * want the block's **bottom** to sit ON the track surface, not floating
   * above it. With block height 0.35, half-height is 0.175 — set Y offset
   * to that so the bottom face is exactly at surface.
   */
  blockYOffset: 0.175,
} as const;

interface BlockEntry {
  /** `endPercentage` — where the block "settles" (its target). */
  endP: number;
  /** Pre-baked Z lane offset in {-2.2, 0, +2.2}. */
  zOffset: number;
  /** Lane label for scoring/effects in M7+. */
  lane: -1 | 0 | 1;
}

export interface BlocksManagerOptions {
  trackData: TrackData;
  lowBeatIndexes: number[];
  highBeatIndexes: number[];
  scene: THREE.Scene;
}

export class BlocksManager {
  private readonly trackData: TrackData;
  private readonly material: BlockMaterial;
  readonly mesh: THREE.InstancedMesh;
  private readonly entries: BlockEntry[];
  private readonly aPickedAt: THREE.InstancedBufferAttribute;

  // Per-frame scratch.
  private readonly _matrix = new THREE.Matrix4();
  private readonly _pos = new THREE.Vector3();
  private readonly _basisX = new THREE.Vector3();
  private readonly _basisY = new THREE.Vector3();
  private readonly _basisZ = new THREE.Vector3();
  private readonly _segDir = new THREE.Vector3();
  private readonly _bitangent = new THREE.Vector3();
  /** Desired bitangent: world +Z, used to pick a consistent side when the
   *  spline has both Y and Z variation (curves + uphills). */
  private readonly _desiredBitangent = new THREE.Vector3(0, 0, 1);
  private readonly _up = new THREE.Vector3(0, 1, 0);

  constructor(opts: BlocksManagerOptions) {
    this.trackData = opts.trackData;

    // Build per-block data: low beats first, then high beats after de-duping
    // any high beats that fall near a low beat.
    const lowBeats = [...opts.lowBeatIndexes];
    const highBeats = removeNearBeats(lowBeats, opts.highBeatIndexes, 5);

    this.entries = [];
    this.appendBeats(lowBeats);
    this.appendBeats(highBeats);

    // InstancedMesh + per-instance pick attribute scaffold.
    const { blockSize, blockYOffset } = BLOCKS_DEFAULTS;
    const geo = new THREE.BoxGeometry(blockSize.x, blockSize.y, blockSize.z);
    geo.translate(0, blockYOffset, 0);
    this.material = createBlockMaterial();
    this.mesh = new THREE.InstancedMesh(geo, this.material, this.entries.length);
    this.mesh.frustumCulled = false; // the whole track is one big bound; cull manually if needed

    // aPickedAt: -1 = not picked.
    const pickedArray = new Float32Array(this.entries.length).fill(-1);
    this.aPickedAt = new THREE.InstancedBufferAttribute(pickedArray, 1);
    geo.setAttribute('aPickedAt', this.aPickedAt);

    // Initial transforms must match what the first update(currentP=0) call
    // would produce — otherwise every block visibly snaps backward by 0.075
    // of track length at song start (slide-in ramp starts at endP-0.075,
    // not endP). Previously this used writeMatrixForPercentage(e.endP)
    // which set the SETTLED position, creating that jump.
    for (let i = 0; i < this.entries.length; i++) {
      this.writeMatrixForCurrentP(i, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    opts.scene.add(this.mesh);
  }

  /** Number of blocks. Used by points-manager to compute total possible score. */
  get totalCount(): number {
    return this.entries.length;
  }

  /**
   * Per-frame update. Walks every block, computes `currentBlockPercentage`
   * (the slide-in ramp), and writes its instance matrix.
   */
  update(currentP: number, currentColor: THREE.Color, time: number, speedFactor = 0): void {
    this.material.setTime(time);
    this.material.setColor(currentColor);
    this.material.setSpeedFactor(speedFactor);

    for (let i = 0; i < this.entries.length; i++) {
      this.writeMatrixForCurrentP(i, currentP);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Mark a block as picked at `time`. M7 will call this from collision. */
  pick(blockIndex: number, time: number): void {
    this.aPickedAt.setX(blockIndex, time);
    this.aPickedAt.needsUpdate = true;
  }

  /** Reset every instance's `aPickedAt` to -1 so previously-picked blocks
   *  render again, AND rewrite every instance matrix to the currentP=0
   *  slide-in state. Call on song restart.
   *
   *  Why matrix reset: block updates are gated off during the pre-roll
   *  cruise, so without this the instances keep their end-of-song
   *  matrices (blockP=1, posP=endP). When the pre-roll ends and
   *  `update(currentP≈0)` fires, every block snaps backward by up to
   *  0.075 of track length to its slide-in start — reads as blocks
   *  "jumping forward" (toward the camera) the instant audio begins. */
  resetAllPicks(): void {
    const arr = this.aPickedAt.array as Float32Array;
    arr.fill(-1);
    this.aPickedAt.needsUpdate = true;
    for (let i = 0; i < this.entries.length; i++) {
      this.writeMatrixForCurrentP(i, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Test only — direct access to the entries for parity tests. */
  get entriesForTest(): readonly BlockEntry[] {
    return this.entries;
  }

  // --- internals ---

  private appendBeats(beatIndexes: number[]): void {
    if (beatIndexes.length === 0) return;
    const splineLen = this.trackData.splinePointCount;
    const denom = splineLen - 4;
    let previousIndex = beatIndexes[0]!;

    for (const beatIndex of beatIndexes) {
      // Lane noise: if consecutive lanes would collide, bump by `(beatIndex %
      // 2) + 1` (which is 1 or 2). Otherwise no bump.
      let noise: number;
      if ((beatIndex % 3) - 1 === (previousIndex % 3) - 1) {
        noise = (beatIndex % 2) + 1;
      } else {
        noise = 0;
      }
      previousIndex = beatIndex + noise;

      // Formula: `(beatIndex + 4) / (splineLen - 4)`. The +4/-4 looks
      // off-by-something but is intentional — don't "correct" it without
      // re-running the parity tests.
      const endP = (beatIndex + 4) / denom;
      const laneRaw = (((beatIndex + noise) % 3) - 1) as -1 | 0 | 1;
      const zOffset = laneRaw * BLOCKS_DEFAULTS.maxDistanceFromCenter;

      this.entries.push({ endP, zOffset, lane: laneRaw });
    }
  }

  /**
   * Slide-in placement algorithm:
   *   blockP = invLerp(endP - 0.5, endP, currentP)        (0..1 ramp-in)
   *   posP   = lerp(endP - 0.075, endP, blockP)
   *   pos    = lerp(splinePoints[u], splinePoints[u+1], inter) + (0,0,zOffset)
   */
  private writeMatrixForCurrentP(i: number, currentP: number): void {
    const e = this.entries[i]!;
    const blockP = clamp01(invLerp(e.endP - 0.5, e.endP, currentP));
    const posP = lerp(e.endP - 0.075, e.endP, blockP);
    this.computeMatrix(posP, e.zOffset);
    this.mesh.setMatrixAt(i, this._matrix);
  }

  /**
   * Sample the SPLINE (not the raw polyline) for both position and tangent.
   * A linear lerp between raw spline control points diverges from the
   * smooth B-spline by a few units at curvature changes, causing visible
   * "hovering" blocks that don't touch the ribbon. Riding the spline
   * keeps blocks visually glued to the track surface.
   */
  private computeMatrix(positionPercentage: number, laneOffset: number): void {
    const spline = this.trackData.spline;
    spline.getPointAt(positionPercentage, this._pos);

    spline.getTangentAt(positionPercentage, this._segDir);
    if (this._segDir.lengthSq() < 1e-8) this._segDir.set(1, 0, 0);
    this._segDir.normalize();

    // Lateral offset along the spline's BITANGENT (perpendicular to the
    // tangent, oriented toward desired +Z). When the track has horizontal
    // curves this keeps blocks glued to the track's cross-section instead of
    // drifting off into world-space Z.
    spline.getBitangentPerpendicularToTangent(
      positionPercentage,
      this._desiredBitangent,
      this._bitangent,
    );
    this._pos.addScaledVector(this._bitangent, laneOffset);

    // Build the same +Z=forward basis as the player.
    // Align the block's local frame to the TRACK's local frame so the bottom
    // face sits flush on the ribbon on sloped AND curved sections:
    //   basisZ = tangent                  (forward)
    //   basisY = bitangent × tangent      (surface normal — block's "up")
    //   basisX = basisY × basisZ          (right — completes the right-handed basis)
    //
    // Subtle: `tangent × bitangent` on a flat track gives -Y (down), so the
    // block renders upside-down if you use that ordering. We need
    // `bitangent × tangent` for positive surface-normal.
    this._basisZ.copy(this._segDir);
    this._basisY.crossVectors(this._bitangent, this._segDir);
    if (this._basisY.lengthSq() < 1e-8) this._basisY.set(0, 1, 0);
    this._basisY.normalize();
    this._basisX.crossVectors(this._basisY, this._basisZ);
    void this._up; // formerly basisX = up × tangent; kept for future toggling

    this._matrix.makeBasis(this._basisX, this._basisY, this._basisZ);
    this._matrix.setPosition(this._pos);
  }
}

/**
 * Returns a NEW array of high beats with any beat within ±range of a low
 * beat removed.
 */
export function removeNearBeats(low: number[], high: number[], range: number): number[] {
  if (low.length === 0) return [...high];
  const lowSet = new Set(low);
  const out: number[] = [];
  for (const beat of high) {
    let near = false;
    for (let d = -range; d < range; d++) {
      if (lowSet.has(beat + d)) { near = true; break; }
    }
    if (!near) out.push(beat);
  }
  return out;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}
