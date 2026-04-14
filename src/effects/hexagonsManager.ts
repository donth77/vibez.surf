import * as THREE from 'three';
import type { TrackData } from '../track/trackData';
import { createHexagonMaterial, type HexagonMaterial } from './hexagonMaterial';

/**
 * Hexagon side pillars.
 *
 * Spawn rule (§4.10a):
 *   for (i = 0; i < splinePoints.length;
 *        i += (int)lerp(128, 32, normalized[i]² )) {
 *     spawn hex at splinePoints[i] ± (horizontalOffset,0) + (0, verticalOffset, 0)
 *     with Euler (0, ±rotationAngle, 0)
 *   }
 *
 * Scale pulse:
 *   - on low-band beat:  scale = base × 1.5,    timer = duration
 *   - on high-band beat: scale = base × 1.083,  timer = duration/6
 *   - otherwise timer decays; scale lerps back toward 1 via
 *     `lerp(1, 1.5, timer / duration)` applied uniformly.
 *
 * Parameter values:
 *   mesh = unit quad, localScale (36, 24, 1)
 *   horizontalOffset = 35, verticalOffset = 5, rotationAngle = 60°
 *   hexagonBeatDuration = 0.5
 *   material = textured mask + color uniform
 */

export interface HexagonsManagerOptions {
  trackData: TrackData;
  lowBeatIndexes: number[];
  highBeatIndexes: number[];
  texture: THREE.Texture;
  scene: THREE.Scene;
}

const BASE_SCALE = new THREE.Vector3(36, 24, 1);
const HORIZONTAL_OFFSET = 35;
const VERTICAL_OFFSET = 5;
const ROTATION_ANGLE_RAD = (60 * Math.PI) / 180;
const HEXAGON_BEAT_DURATION = 0.5;

export class HexagonsManager {
  private readonly container: THREE.Group;
  private readonly material: HexagonMaterial;
  private readonly hexagons: THREE.Mesh[] = [];
  private readonly trackData: TrackData;
  private readonly lowBeatSet: Set<number>;
  private readonly highBeatSet: Set<number>;
  private timer = 0;
  private lastPulseIndex = -1;

  // Scratch.
  private readonly _scaleVec = new THREE.Vector3();

  constructor(opts: HexagonsManagerOptions) {
    this.trackData = opts.trackData;
    this.lowBeatSet = new Set(opts.lowBeatIndexes);
    this.highBeatSet = new Set(opts.highBeatIndexes);

    this.material = createHexagonMaterial(opts.texture);
    this.container = new THREE.Group();
    this.container.name = 'HexagonsContainer';

    const quad = new THREE.PlaneGeometry(1, 1);
    this.spawnAll(quad);

    opts.scene.add(this.container);
  }

  update(currentP: number, currentColor: THREE.Color, dt: number): void {
    this.material.setColor(currentColor);

    // Current chunk index via spline sub-spline lookup.
    const subIdx = this.trackData.spline.getSubSplineIndexes(currentP);
    const currentIndex = subIdx.firstSubSplinePointIndex;

    // Only apply a beat-triggered pulse on the frame the chunk index changes
    // (prevents re-triggering every frame while the index stays the same).
    const isLowBeat = this.lowBeatSet.has(currentIndex);
    const isHighBeat = this.highBeatSet.has(currentIndex);
    const beatChanged = currentIndex !== this.lastPulseIndex;

    if (beatChanged && isLowBeat && this.timer < HEXAGON_BEAT_DURATION / 2) {
      this.timer = HEXAGON_BEAT_DURATION;
      this.setAllScales(1.5);
      this.lastPulseIndex = currentIndex;
    } else if (beatChanged && isHighBeat && this.timer < HEXAGON_BEAT_DURATION / 6) {
      this.timer = HEXAGON_BEAT_DURATION / 6;
      this.setAllScales(1 + 0.5 / 6);
      this.lastPulseIndex = currentIndex;
    } else if (this.timer > 0) {
      this.timer -= dt;
      const factor = THREE.MathUtils.lerp(1, 1.5, Math.max(0, this.timer / HEXAGON_BEAT_DURATION));
      this.setAllScales(factor);
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.container);
    for (const h of this.hexagons) {
      (h.geometry as THREE.BufferGeometry).dispose();
    }
    this.material.dispose();
    this.hexagons.length = 0;
  }

  // --- internals ---

  private spawnAll(quad: THREE.PlaneGeometry): void {
    const { splinePoints, splinePointCount, normalizedIntensities, spline } = this.trackData;
    const desiredBitangent = new THREE.Vector3(0, 0, 1);
    const bitangent = new THREE.Vector3();
    let i = 0;
    while (i < splinePointCount) {
      const intensity = normalizedIntensities[i]!;
      const step = Math.max(1, Math.floor(THREE.MathUtils.lerp(128, 32, intensity * intensity)));

      const px = splinePoints[i * 3]!;
      const py = splinePoints[i * 3 + 1]! + VERTICAL_OFFSET;
      const pz = splinePoints[i * 3 + 2]!;

      // POSITION uses the spline's bitangent so the pillars sit on the
      // track's cross-section even when the track sweeps horizontally.
      // ROTATION stays at fixed angles (±60° from world +X) —
      // the horizontal curves are subtle enough (≤ a few degrees of tangent
      // yaw) that rotating the pillars to match wasn't worth the fragility.
      const percentage = i / (splinePointCount - 1);
      spline.getBitangentPerpendicularToTangent(percentage, desiredBitangent, bitangent);

      const hex1 = new THREE.Mesh(quad, this.material);
      hex1.scale.copy(BASE_SCALE);
      hex1.position.set(
        px + bitangent.x * HORIZONTAL_OFFSET,
        py,
        pz + bitangent.z * HORIZONTAL_OFFSET,
      );
      hex1.rotation.y = ROTATION_ANGLE_RAD;
      this.container.add(hex1);
      this.hexagons.push(hex1);

      const hex2 = new THREE.Mesh(quad, this.material);
      hex2.scale.copy(BASE_SCALE);
      hex2.position.set(
        px - bitangent.x * HORIZONTAL_OFFSET,
        py,
        pz - bitangent.z * HORIZONTAL_OFFSET,
      );
      hex2.rotation.y = Math.PI - ROTATION_ANGLE_RAD;
      this.container.add(hex2);
      this.hexagons.push(hex2);

      i += step;
    }
  }

  private setAllScales(factor: number): void {
    this._scaleVec.copy(BASE_SCALE).multiplyScalar(factor);
    for (const h of this.hexagons) h.scale.copy(this._scaleVec);
  }
}
