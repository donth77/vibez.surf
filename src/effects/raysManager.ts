import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { TrackData } from '../track/trackData';

/**
 * A ring of radial "speed lines" extending outward from the origin toward the
 * distance. Color, width, and rotation speed are all modulated by the current
 * audio intensity; beats briefly snap everything to a mid-range.
 *
 * Parameter values:
 *   raysCount          = 21
 *   startRadius        = 0
 *   endRadius          = 5000
 *   distance           = 1
 *   lowIntensityColor  = rgba(0.039, 0.039, 0.039, 0.502)
 *   highIntensityColor = rgba(0.588, 0.588, 0.588, 0.588)
 *   minWidth/maxWidth  = 0.75 / 5
 *   minSpeed/maxSpeed  = 0   / 45  (deg/s × dt → per-frame Z rotation)
 *   beatDuration       = 0.06
 *
 * We parent the ring to the camera (via a wrapper) so it stays locked in
 * front of the player's view. The rays spin around the camera's view axis
 * to create the classic "warp streak" motion.
 */

const RAYS_COUNT = 21;
const START_RADIUS = 0;
const END_RADIUS = 5000;
const DISTANCE = 1;
const MIN_WIDTH = 0.75;
const MAX_WIDTH = 5;
const MIN_SPEED = 0;
const MAX_SPEED = 45;
const BEAT_DURATION = 0.06;
const LOW_COLOR = new THREE.Color(0.039, 0.039, 0.039);
const HIGH_COLOR = new THREE.Color(0.588, 0.588, 0.588);
const LOW_ALPHA = 0.502;
const HIGH_ALPHA = 0.588;

export interface RaysManagerOptions {
  camera: THREE.Camera;
  trackData: TrackData;
  audio: HTMLAudioElement;
}

export class RaysManager {
  private readonly wrapper: THREE.Group;
  private readonly lines: LineSegments2;
  private readonly material: LineMaterial;
  private readonly trackData: TrackData;
  private readonly audio: HTMLAudioElement;

  private beatTimer = 0;
  private previousU = -1;
  private readonly _color = new THREE.Color();

  constructor(opts: RaysManagerOptions) {
    this.trackData = opts.trackData;
    this.audio = opts.audio;

    // Build 2 × N vertex positions. Ray i starts at radius·(cosθ, sinθ, 0) and
    // ends at endRadius·(cosθ, sinθ, 0) + (0, 0, distance). We don't set Z for the start
    const positions = new Float32Array(RAYS_COUNT * 2 * 3);
    for (let i = 0; i < RAYS_COUNT; i++) {
      const angle = (2 * Math.PI * i) / RAYS_COUNT;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const baseStart = i * 6;
      positions[baseStart]     = START_RADIUS * cos;
      positions[baseStart + 1] = START_RADIUS * sin;
      positions[baseStart + 2] = 0;
      positions[baseStart + 3] = END_RADIUS * cos;
      positions[baseStart + 4] = END_RADIUS * sin;
      positions[baseStart + 5] = DISTANCE;
    }

    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);

    this.material = new LineMaterial({
      color: 0xffffff,
      linewidth: MIN_WIDTH,
      transparent: true,
      depthWrite: false,
      depthTest: true,     // let scene geometry occlude the rays (they're a background)
      worldUnits: true,    // linewidth is in world units
    });
    this.material.resolution.set(window.innerWidth, window.innerHeight);

    this.lines = new LineSegments2(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = -1; // paint before the rest of the scene

    this.wrapper = new THREE.Group();
    // Push the whole ring far ahead of the camera (in camera-local -Z). The
    // rays become a distant backdrop — their perspective-foreshortened spokes
    // peek around the track/hexagons/ship instead of covering them.
    this.wrapper.position.set(0, 0, -400);
    this.wrapper.add(this.lines);
    opts.camera.add(this.wrapper);
  }

  update(dt: number): void {
    const duration = this.audio.duration;
    if (!isFinite(duration) || duration <= 0) return;
    const currentP = Math.min(0.9999, Math.max(0, this.audio.currentTime / duration));

    const subIdx = this.trackData.spline.getSubSplineIndexes(currentP);
    const u = Math.min(this.trackData.normalizedIntensities.length - 2, subIdx.firstSubSplinePointIndex);
    const intensity = this.trackData.normalizedIntensities[u]!;

    // Beat detection — same test as the rocket-fire pulse: a sharp rise in
    // intensity from this chunk to the next.
    let t = intensity;
    let rotationRate = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * intensity;
    let width = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * intensity;
    let alpha = LOW_ALPHA + (HIGH_ALPHA - LOW_ALPHA) * intensity;
    this._color.copy(LOW_COLOR).lerp(HIGH_COLOR, intensity);

    const beatHere =
      this.beatTimer <= 0 &&
      this.previousU !== u &&
      u + 1 < this.trackData.normalizedIntensities.length &&
      this.trackData.normalizedIntensities[u]! - this.trackData.normalizedIntensities[u + 1]! <= -0.1;

    if (beatHere) {
      this.beatTimer = BEAT_DURATION;
      this.previousU = u;
    }
    if (this.beatTimer > 0) {
      t = 0.5;
      rotationRate = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * 0.5;
      width = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * 0.5;
      alpha = LOW_ALPHA + (HIGH_ALPHA - LOW_ALPHA) * 0.5;
      this._color.copy(LOW_COLOR).lerp(HIGH_COLOR, 0.5);
      this.beatTimer -= dt;
    }
    void t;

    this.material.color.copy(this._color);
    this.material.opacity = alpha;
    this.material.linewidth = width;

    // Rotate the ring around its local Z (view axis) by rotationRate deg per second. The `rate * Time.deltaTime` into Quaternion.Euler, which interprets degrees
    const dRad = (rotationRate * dt * Math.PI) / 180;
    this.wrapper.rotation.z += dRad;
  }

  onResize(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  dispose(camera: THREE.Camera): void {
    camera.remove(this.wrapper);
    (this.lines.geometry as LineSegmentsGeometry).dispose();
    this.material.dispose();
  }
}
