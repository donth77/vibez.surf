import * as THREE from 'three';
import type { TrackData } from '../track/trackData';
import { RocketFire } from '../effects/rocketFire';

/**
 * Player controller — rides the spline to audio playback time.
 *
 * Each frame:
 *  - currentP = audio.currentTime / audio.duration
 *  - inputOffset += inputX · spline.bitangentPerp(currentP, +Z)   (clamped)
 *  - position    = spline.point(currentP) + inputOffset
 *  - forward     = lerp(forward, spline.tangent(currentP), 2.5·dt)
 *
 * Input: pointer-locked mouse delta on desktop, touch swipe on mobile. Sign
 * convention for mouse: `inputX = -movementX · mouseSpeed` so a rightward
 * movement pushes the ship lateral-right.
 *
 * Camera is parented to the player and slides between near/far positions based
 * on the current track-color hue (high hue = slow = pull camera back).
 *
 * Block collision and rocket-fire intensity hooks are wired in M6/M9.
 */

export interface PlayerControllerOptions {
  trackData: TrackData;
  audio: HTMLAudioElement;
  camera: THREE.PerspectiveCamera;
  /** Domain element to attach pointerlock + touch listeners to. */
  inputTarget: HTMLElement;
  spaceship: THREE.Object3D;
  /** Ship submaterials whose emissive color tracks the song color. */
  syncedEmissiveMaterials?: THREE.MeshStandardMaterial[];
  scene: THREE.Scene;

  // Tunables — defaults from the authored-asset values.
  rotationToTangentSmoothness?: number;
  mouseSpeed?: number;
  maxInputOffset?: number;
  /** Local-space camera offset at slow speed (low color hue → fast). Z= behind ship. */
  cameraNear?: THREE.Vector3;
  /** Local-space camera offset at fast speed. */
  cameraFar?: THREE.Vector3;
}

export class PlayerController {
  private readonly trackData: TrackData;
  private readonly audio: HTMLAudioElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly inputTarget: HTMLElement;
  private readonly scene: THREE.Scene;

  private readonly rotationSmoothness: number;
  private readonly maxInputOffset: number;
  private readonly cameraNear: THREE.Vector3;
  private readonly cameraFar: THREE.Vector3;
  private readonly syncedEmissiveMaterials: THREE.MeshStandardMaterial[];

  /** Player root (attached to scene). The spaceship + camera ride this. */
  readonly root = new THREE.Group();
  /** Camera rig — camera lives here in the player's local space. */
  private readonly cameraRig = new THREE.Group();
  private readonly spaceship: THREE.Object3D;

  /** Per-frame mouse / touch delta accumulator (cleared each tick). */
  private mouseDeltaX = 0;
  /** Copy of mouseDeltaX captured for the tilt animation. */
  private frameSwipeDelta = 0;
  /** -1, 0, +1 from keyboard hold (left/right arrows or A/D). Sign matches mouseDeltaX. */
  private keyAxis = 0;
  /**
   * Signed lateral offset along the spline's bitangent, clamped to ±
   * maxInputOffset. Scalar (not Vector3) so the collision sweep can compare
   * it directly to each block's laneOffset — both are "signed distance
   * along the lane axis." Applied as `position = splinePoint + bitangent ·
   * inputScalar`.
   */
  private inputScalar = 0;
  /** Current ship roll (degrees) for tilt animation. */
  private currentRoll = 0;
  /** Two rocket-fire emitters (left + right thruster). */
  private readonly rocketFires: RocketFire[] = [];

  // Rocket-pulse state for pickup feedback. The block's own animation
  // plays behind the ship at speed and can be missed, but the thrusters
  // are always in view — briefly boosting their length on each pickup
  // gives every pick a visible "charge" without the distraction of a
  // ship-body emissive flash.
  private pickBoostTimer = 0;                    // seconds remaining
  private readonly pickBoostDuration = 0.25;     // total decay window
  // Multiplicative so the pulse feels proportional at every song volume:
  // at peak, flame intensity is scaled by (1 + this value) before the
  // normal intensity→length mapping. 0.3 = "+30% flame at peak".
  private readonly pickBoostMagnitude = 0.3;

  // Pre-roll state — ship cruises along the runway (behind the spline origin)
  // at constant speed before audio starts. During pre-roll the normal audio-
  // driven position / orientation code is bypassed.
  private preRollActive = false;
  private preRollElapsed = 0;
  private preRollSeconds = 0;
  private preRollDistance = 0;
  private preRollResolve: (() => void) | null = null;
  private readonly _preRollOrigin = new THREE.Vector3();
  private readonly _preRollTangent = new THREE.Vector3();
  /** Runway bitangent (≈ world +Z, perpendicular to the straight runway).
   *  Captured at pre-roll start so input-driven lateral steering works the
   *  same way it does during normal play. */
  private readonly _preRollBitangent = new THREE.Vector3();

  // Post-roll state — ship cruises past the spline endpoint into the
  // forward-extension runway after audio ends. Lets the track "extend
  // into the distance" for a beat before the end-song panel pops up.
  private postRollActive = false;
  private postRollElapsed = 0;
  private postRollSeconds = 0;
  private postRollDistance = 0;
  private postRollResolve: (() => void) | null = null;
  private readonly _postRollOrigin = new THREE.Vector3();
  private readonly _postRollTangent = new THREE.Vector3();
  private readonly _postRollBitangent = new THREE.Vector3();

  // Scratch.
  private readonly _point = new THREE.Vector3();
  private readonly _tangent = new THREE.Vector3();
  private readonly _bitangent = new THREE.Vector3();
  private readonly _color = new THREE.Color();
  private readonly _hsl = { h: 0, s: 0, l: 0 };
  private readonly _basisX = new THREE.Vector3();
  private readonly _basisY = new THREE.Vector3();
  private readonly _basisZ = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _bitangentDesired = new THREE.Vector3(0, 0, 1);
  private readonly _targetForward = new THREE.Vector3();
  private readonly _currentForward = new THREE.Vector3(1, 0, 0);

  constructor(opts: PlayerControllerOptions) {
    this.trackData = opts.trackData;
    this.audio = opts.audio;
    this.camera = opts.camera;
    this.inputTarget = opts.inputTarget;
    this.scene = opts.scene;
    this.rotationSmoothness = opts.rotationToTangentSmoothness ?? 2.5;
    // Authored value was 3; bumped for demo feel so a held key produces more
    // visible lateral sway beyond the outer block lanes (±2.2).
    this.maxInputOffset = opts.maxInputOffset ?? 5;
    // Camera offsets are chosen at startup by screen orientation (landscape
    // vs portrait).
    const landscape = window.innerWidth >= window.innerHeight;
    this.cameraNear = opts.cameraNear ?? (landscape
      ? new THREE.Vector3(0, 1.376, -2.143)
      : new THREE.Vector3(0, 2.0, -2.5));
    this.cameraFar = opts.cameraFar ?? (landscape
      ? new THREE.Vector3(0, 2.424, -4.069)
      : new THREE.Vector3(0, 3.5, -5));
    this.spaceship = opts.spaceship;
    this.syncedEmissiveMaterials = opts.syncedEmissiveMaterials ?? [];

    this.root.add(this.spaceship);
    this.root.add(this.cameraRig);
    this.cameraRig.add(this.camera);
    this.camera.position.copy(this.cameraNear);
    this.scene.add(this.root);

    // Lift the ship above the track surface. spline.point() returns the
    // *centerline* of the ribbon (which is also the ribbon's surface — it has
    // zero vertical thickness). Without a +Y offset, the ship's lower half
    // clips through the polygons. Use the ship's bounding box to size the lift
    // so we don't depend on hard-coded scale.
    const shipBox = new THREE.Box3().setFromObject(this.spaceship);
    const shipSize = new THREE.Vector3();
    shipBox.getSize(shipSize);
    const halfHeight = shipSize.y * 0.5;
    const shipHalfLength = shipSize.z * 0.5;
    const clearance = 0.4; // visible "hover" gap
    this.spaceship.position.y = halfHeight + clearance;

    // No external lights — the spaceship's per-submaterial emission (yellow
    // accents on most surfaces) reads on its own against the dark scene.

    // Three rocket-fire emitters, one per visible engine on the ship model.
    // Offsets derived from the authored engine transforms, converted to
    // "fraction of ship half-extent" so they stay correct regardless of our
    // ship scale:
    //
    //   Engine Y (0.399–0.437) sits ~0.17–0.21 units above the ship origin;
    //   the spaceship scale is 6.5 over a model Y-extent of ~0.2, giving
    //   effective ship half-height ~0.65. So engine Y ≈ +0.21 / 0.65 ≈ 32%
    //   of half-height above center.
    //
    //   Engine Z (-0.256 sides, -0.421 center) → rear of ship. Center engine
    //   is slightly further back (~0.42 / 0.65 = 65% of half-length) than the
    //   side engines (~0.256 / 0.65 = 40%).
    //
    //   Engine X (±0.2051) → ~±0.2 / 0.66 = ~±30% of half-width.
    const halfLen = shipHalfLength;
    const halfW = shipSize.x / 2;
    const halfH = halfHeight;
    const engineOffsets: ReadonlyArray<readonly [number, number, number]> = [
      [ 0,             halfH * 0.40, -halfLen * 0.65 ],  // center engine, slightly higher
      [ halfW * 0.30,  halfH * 0.30, -halfLen * 0.40 ],  // right engine
      [-halfW * 0.30,  halfH * 0.30, -halfLen * 0.40 ],  // left engine
    ];
    for (const [x, y, z] of engineOffsets) {
      const rf = new RocketFire();
      rf.mesh.position.set(x, y, z);
      // Parent to the spaceship so flames follow pitch/roll tilt.
      this.spaceship.add(rf.mesh);
      this.rocketFires.push(rf);
    }
    void clearance;

    // Initial position: spline.point(0).
    this.trackData.spline.getPointAt(0, this._point);
    this.root.position.copy(this._point);
    this.root.lookAt(this._point.x + 1, this._point.y, this._point.z); // +X forward as start
  }

  attachInput(): () => void {
    // Keyboard-only — left/right arrows or A/D drive `keyAxis` while held.
    // Touch swipe is also kept for mobile.
    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      keys.add(e.code);
      this.recomputeKeyAxis(keys);
      // Stop the page from scrolling on arrow presses.
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      this.recomputeKeyAxis(keys);
    };
    const onBlur = () => { keys.clear(); this.keyAxis = 0; };

    let lastTouchX = 0;
    let touchActive = false;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1 && e.touches[0]) {
        lastTouchX = e.touches[0].clientX;
        touchActive = true;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive || !e.touches[0]) return;
      const x = e.touches[0].clientX;
      this.mouseDeltaX += x - lastTouchX;
      lastTouchX = x;
    };
    const onTouchEnd = () => { touchActive = false; };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.inputTarget.addEventListener('touchstart', onTouchStart, { passive: true });
    this.inputTarget.addEventListener('touchmove', onTouchMove, { passive: true });
    this.inputTarget.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      this.inputTarget.removeEventListener('touchstart', onTouchStart);
      this.inputTarget.removeEventListener('touchmove', onTouchMove);
      this.inputTarget.removeEventListener('touchend', onTouchEnd);
    };
  }

  private recomputeKeyAxis(keys: Set<string>): void {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    // Pressing LEFT should move the player toward the LEFT lane (z = +2.2 in
    // our coords, since blocks at lane=+1 sit at +Z·maxDistanceFromCenter).
    // The downstream math is `inputOffset += bitangent * inputX`, with
    // bitangent ≈ +Z. So LEFT → positive inputX. Direct mapping:
    this.keyAxis = (left ? 1 : 0) - (right ? 1 : 0);
  }

  /** Player's current lateral offset along the bitangent (≈ world +Z). Used
   *  by the block collision sweep to decide pick vs miss. */
  get lateralOffset(): number {
    return this.inputScalar;
  }

  /** Reads the spline color at the current audio time. Used by `BlocksManager`
   *  (and the M8 color-syncher) so they don't need their own clock or spline.
   */
  getCurrentColor(out: THREE.Color): THREE.Color {
    const dur = this.audio.duration;
    if (!isFinite(dur) || dur <= 0) return out.set(1, 1, 1);
    const t = Math.min(0.9999, Math.max(0, this.audio.currentTime / dur));
    return this.trackData.spline.getColorAt(t, out);
  }

  /** 0..1 ship speed factor derived from the current hue (same math the
   *  camera + rocket fire use). Exposed so other systems (e.g. the block
   *  pickup animation) can scale with speed. */
  /** Briefly boost the rocket-fire length — called from the onPick handler
   *  each time a block is collected so every pick has visible feedback. */
  triggerPickBoost(): void {
    this.pickBoostTimer = this.pickBoostDuration;
  }

  getCurrentSpeedFactor(): number {
    const dur = this.audio.duration;
    if (!isFinite(dur) || dur <= 0) return 0;
    const t = Math.min(0.9999, Math.max(0, this.audio.currentTime / dur));
    this.trackData.spline.getColorAt(t, this._color);
    this._color.getHSL(this._hsl);
    return clamp01((0.83 - this._hsl.h) / 0.83);
  }

  /**
   * Start a pre-roll cruise. Ship is placed `distance` units BEHIND the
   * spline origin (along -tangent), then linearly translated toward the
   * origin over `seconds`. Audio stays paused during this window; the
   * returned promise resolves when the ship arrives at the origin so the
   * caller can kick playback.
   */
  startPreRoll(seconds: number, distance: number): Promise<void> {
    // If a previous pre-roll is somehow still pending, resolve it so we
    // don't leak promises.
    this.preRollResolve?.();
    this.preRollActive = true;
    this.preRollElapsed = 0;
    this.preRollSeconds = seconds;
    this.preRollDistance = distance;
    this.trackData.spline.getPointAt(0, this._preRollOrigin);
    this.trackData.spline.getTangentAt(0, this._preRollTangent);
    if (this._preRollTangent.lengthSq() < 1e-8) this._preRollTangent.set(1, 0, 0);
    this._preRollTangent.normalize();
    // Runway bitangent = spline bitangent at t=0 — keeps steering direction
    // consistent with what normal play will use at currentP=0.
    this.trackData.spline.getBitangentPerpendicularToTangent(
      0, this._bitangentDesired, this._preRollBitangent,
    );
    // Zero out any carried-over lateral input so the ship starts centred.
    this.inputScalar = 0;
    this.mouseDeltaX = 0;
    this.frameSwipeDelta = 0;
    this.currentRoll = 0;
    // Seed currentForward to tangent so the first applyForward() doesn't snap.
    this._currentForward.copy(this._preRollTangent);
    return new Promise<void>((resolve) => {
      this.preRollResolve = resolve;
    });
  }

  private updatePreRoll(dt: number): void {
    this.preRollElapsed += dt;
    const t = Math.min(1, this.preRollElapsed / this.preRollSeconds);
    // CONSTANT-velocity cruise. Distance is sized by the caller so that
    // this velocity (= distance/seconds) equals the song's velocity at
    // currentP=0, giving a seamless handoff when audio starts.
    const backOffset = this.preRollDistance * (1 - t);

    // Same input → lateral-offset math as normal update so steering feels
    // identical during the runway glide.
    const keyInput = -this.keyAxis * KEYBOARD_LATERAL_PER_SEC * dt;
    const swipeInput = this.mouseDeltaX * PIXELS_TO_INPUT_AXIS;
    this.frameSwipeDelta = this.mouseDeltaX;
    this.mouseDeltaX = 0;
    this.inputScalar += keyInput + swipeInput;
    if (this.inputScalar > this.maxInputOffset) this.inputScalar = this.maxInputOffset;
    else if (this.inputScalar < -this.maxInputOffset) this.inputScalar = -this.maxInputOffset;

    // Position = origin + tangent · -backOffset + bitangent · inputScalar.
    this.root.position.copy(this._preRollOrigin)
      .addScaledVector(this._preRollTangent, -backOffset)
      .addScaledVector(this._preRollBitangent, this.inputScalar);

    // Orient forward along the runway tangent (straight).
    this.applyForward(this._preRollTangent);

    // Spaceship tilt + bob — same animation as normal play so the ship
    // doesn't feel dead during the cruise.
    this.updateSpaceshipAnimation(dt);

    // Color / emissive / rocket fire from spline start (first chunk color).
    this.trackData.spline.getColorAt(0, this._color);
    for (const mat of this.syncedEmissiveMaterials) {
      mat.emissive.copy(this._color);
    }
    // Rocket intensity: use the first chunk's normalized intensity so the
    // thrust size at the pre-roll→song handoff matches exactly what the
    // normal update will produce at currentP=0 (prevents a visible pulse).
    const firstIntensity = this.trackData.normalizedIntensities[0] ?? 0.5;
    for (const rf of this.rocketFires) {
      rf.update(performance.now() / 1000, firstIntensity, this._color, ROCKET_MIN_SPEED, ROCKET_MAX_SPEED);
    }

    // Camera: match what the normal update would produce at p=0 so there's
    // no snap when audio starts. Same hue→speed→lerp math as the main path.
    this._color.getHSL(this._hsl);
    const currentSpeed = clamp01((0.83 - this._hsl.h) / 0.83);
    this.camera.position.lerpVectors(this.cameraFar, this.cameraNear, currentSpeed);
    _scratchVec.set(
      this.camera.position.x,
      this.camera.position.y - 20 * Math.sin(CAMERA_PITCH_RAD),
      this.camera.position.z + 20 * Math.cos(CAMERA_PITCH_RAD),
    );
    this.cameraRig.localToWorld(_scratchVec);
    this.camera.lookAt(_scratchVec);

    if (t >= 1) {
      this.preRollActive = false;
      const resolve = this.preRollResolve;
      this.preRollResolve = null;
      resolve?.();
    }
  }

  /** True while the ship is gliding along the runway, before audio starts. */
  get isPreRolling(): boolean {
    return this.preRollActive;
  }

  /**
   * Start a post-roll cruise. Mirrors `startPreRoll` but forward — ship
   * leaves the spline endpoint and keeps travelling along the forward
   * runway extension for `seconds`. Callers await the returned promise
   * before popping the end-song panel so the track reads as extending
   * into the distance before the modal takes over.
   */
  startPostRoll(seconds: number, distance: number): Promise<void> {
    this.postRollResolve?.();
    this.postRollActive = true;
    this.postRollElapsed = 0;
    this.postRollSeconds = seconds;
    this.postRollDistance = distance;
    // Origin = the raw spline point at the join-T, NOT root.position.
    // root.position already has `bitangent × inputScalar` baked in from
    // normal update; if we captured that here and also re-applied it
    // per frame in updatePostRoll, the ship would jump sideways by the
    // lateral offset. Since normal update has position tracking to
    // 1023/1024, the spline point at the join-T matches the ship's
    // spline-centerline position at the instant audio ends → no snap.
    const joinT = 1023 / 1024;
    this.trackData.spline.getPointAt(joinT, this._postRollOrigin);
    this.trackData.spline.getTangentAt(joinT, this._postRollTangent);
    if (this._postRollTangent.lengthSq() < 1e-8) this._postRollTangent.set(1, 0, 0);
    this._postRollTangent.normalize();
    this.trackData.spline.getBitangentPerpendicularToTangent(
      joinT, this._bitangentDesired, this._postRollBitangent,
    );
    this.mouseDeltaX = 0;
    this.frameSwipeDelta = 0;
    return new Promise<void>((resolve) => {
      this.postRollResolve = resolve;
    });
  }

  /** True while the ship is gliding past the spline endpoint, before the score panel pops. */
  get isPostRolling(): boolean {
    return this.postRollActive;
  }

  private updatePostRoll(dt: number): void {
    this.postRollElapsed += dt;
    const t = Math.min(1, this.postRollElapsed / this.postRollSeconds);
    // CONSTANT-velocity cruise. Distance sized so velocity matches the
    // song's end velocity for a seamless handoff.
    const forwardOffset = this.postRollDistance * t;

    // Keep steering responsive so the player can still swerve if they
    // feel like it — same input math as normal play.
    const keyInput = -this.keyAxis * KEYBOARD_LATERAL_PER_SEC * dt;
    const swipeInput = this.mouseDeltaX * PIXELS_TO_INPUT_AXIS;
    this.frameSwipeDelta = this.mouseDeltaX;
    this.mouseDeltaX = 0;
    this.inputScalar += keyInput + swipeInput;
    if (this.inputScalar > this.maxInputOffset) this.inputScalar = this.maxInputOffset;
    else if (this.inputScalar < -this.maxInputOffset) this.inputScalar = -this.maxInputOffset;

    this.root.position.copy(this._postRollOrigin)
      .addScaledVector(this._postRollTangent, forwardOffset)
      .addScaledVector(this._postRollBitangent, this.inputScalar);

    this.applyForward(this._postRollTangent);
    this.updateSpaceshipAnimation(dt);

    // Color / emissive / rocket fire from the song's last chunk (sampled
    // at the same joinT the runway mesh uses) — keeps the mood
    // continuous with whatever the track was just doing at its end.
    this.trackData.spline.getColorAt(1023 / 1024, this._color);
    for (const mat of this.syncedEmissiveMaterials) {
      mat.emissive.copy(this._color);
    }
    const intensities = this.trackData.normalizedIntensities;
    const lastIntensity = intensities[intensities.length - 1] ?? 0.5;
    for (const rf of this.rocketFires) {
      rf.update(performance.now() / 1000, lastIntensity, this._color, ROCKET_MIN_SPEED, ROCKET_MAX_SPEED);
    }

    this._color.getHSL(this._hsl);
    const currentSpeed = clamp01((0.83 - this._hsl.h) / 0.83);
    this.camera.position.lerpVectors(this.cameraFar, this.cameraNear, currentSpeed);
    _scratchVec.set(
      this.camera.position.x,
      this.camera.position.y - 20 * Math.sin(CAMERA_PITCH_RAD),
      this.camera.position.z + 20 * Math.cos(CAMERA_PITCH_RAD),
    );
    this.cameraRig.localToWorld(_scratchVec);
    this.camera.lookAt(_scratchVec);

    if (t >= 1) {
      this.postRollActive = false;
      const resolve = this.postRollResolve;
      this.postRollResolve = null;
      resolve?.();
    }
  }

  /** Call once per frame. Dt in seconds. */
  update(dt: number): void {
    if (this.preRollActive) {
      this.updatePreRoll(dt);
      return;
    }
    if (this.postRollActive) {
      this.updatePostRoll(dt);
      return;
    }
    const duration = this.audio.duration;
    if (!isFinite(duration) || duration <= 0) return;
    // Position can track audio all the way to the drawable end of the
    // ribbon (1023/1024 with default resolution). The earlier 0.995
    // clamp fixed camera shake but also froze the ship for the last
    // ~0.5s of audio, which read as hitting an invisible wall. Only the
    // TANGENT goes erratic near the endpoint (duplicated control points
    // → direction oscillates frame-to-frame), so we clamp that alone:
    // position follows audio, rotation samples a safe T.
    const rawP = Math.max(0, this.audio.currentTime / duration);
    const currentP = Math.min(1023 / 1024, rawP);
    const tangentP = Math.min(0.995, rawP);

    const spline = this.trackData.spline;

    // Input → lateral offset along bitangent.
    //   keyAxis: +1 when LEFT held, -1 when RIGHT held (see recomputeKeyAxis)
    //   bitangent: ≈ world +Z (perpendicular to spline tangent)
    //   Camera looks along player-local +Z; in three.js's right-handed view
    //   world +Z ends up on the SCREEN RIGHT, so moving the ship visually LEFT
    //   means decreasing world Z (inputX negative).
    const keyInput = -this.keyAxis * KEYBOARD_LATERAL_PER_SEC * dt;
    // Swipe: mouseDeltaX positive = swipe right = ship should move screen-right
    // = world +Z = inputOffset.z positive. So swipeInput has the SAME sign as
    // mouseDeltaX (no negation — matches keyboard's RIGHT-key direction).
    const swipeInput = this.mouseDeltaX * PIXELS_TO_INPUT_AXIS;
    const inputX = keyInput + swipeInput;
    // Capture swipe contribution for the tilt animation before we zero it.
    this.frameSwipeDelta = this.mouseDeltaX;
    this.mouseDeltaX = 0;

    // Bitangent is derived from tangent → use the stable `tangentP` so
    // lateral offset doesn't flip direction near the endpoint.
    spline.getBitangentPerpendicularToTangent(tangentP, this._bitangentDesired, this._bitangent);
    this.inputScalar += inputX;
    if (this.inputScalar > this.maxInputOffset) this.inputScalar = this.maxInputOffset;
    else if (this.inputScalar < -this.maxInputOffset) this.inputScalar = -this.maxInputOffset;

    // Position follows audio all the way to the drawable end.
    spline.getPointAt(currentP, this._point);
    this.root.position.copy(this._point).addScaledVector(this._bitangent, this.inputScalar);

    // Rotation uses the clamped `tangentP` to avoid endpoint-duplication jitter.
    spline.getTangentAt(tangentP, this._tangent);
    if (this._tangent.lengthSq() > 1e-8) {
      this._targetForward.copy(this._tangent).normalize();
      this._currentForward.lerp(this._targetForward, Math.min(1, this.rotationSmoothness * dt));
      if (this._currentForward.lengthSq() < 1e-8) this._currentForward.set(1, 0, 0);
      this._currentForward.normalize();
      this.applyForward(this._currentForward);
    }

    // Camera distance modulated by current color hue (high hue = uphill = slow → far).
    spline.getColorAt(currentP, this._color);
    this._color.getHSL(this._hsl);

    // Sync ship emissive color to the current track color.
    for (const mat of this.syncedEmissiveMaterials) {
      mat.emissive.copy(this._color);
    }

    // Spaceship tilt + bob animation.
    this.updateSpaceshipAnimation(dt);

    // Rocket fire. Use the spline's sub-spline index for `u` so the
    // intensity lookup matches the chunk-index convention. Pickup boost
    // is added on top (decays linearly over `pickBoostDuration`) so every
    // collected block produces a visible thruster flare.
    const intensities = this.trackData.normalizedIntensities;
    const subIdx = spline.getSubSplineIndexes(currentP);
    const u = Math.min(intensities.length - 2, subIdx.firstSubSplinePointIndex);
    const intensity = intensities[u]!;
    if (this.pickBoostTimer > 0) this.pickBoostTimer = Math.max(0, this.pickBoostTimer - dt);
    const boostFraction = this.pickBoostTimer / this.pickBoostDuration;
    const rocketIntensity = Math.min(1, intensity * (1 + boostFraction * this.pickBoostMagnitude));
    for (const rf of this.rocketFires) {
      rf.update(performance.now() / 1000, rocketIntensity, this._color, ROCKET_MIN_SPEED, ROCKET_MAX_SPEED);
    }
    // currentSpeed = invLerp(0.83, 0, hue). hue 0.83 → speed 0; hue 0 → speed 1.
    const currentSpeed = clamp01((0.83 - this._hsl.h) / 0.83);
    this.camera.position.lerpVectors(this.cameraFar, this.cameraNear, currentSpeed);

    // Camera local pitch = 15° (Euler (15, 0, 0)). Build a lookAt target
    // along the (0, -sin15°, cos15°) direction from the camera's current
    // local position, then convert to world via the camera rig (which
    // inherits the player's rotation).
    _scratchVec.set(
      this.camera.position.x,
      this.camera.position.y - 20 * Math.sin(CAMERA_PITCH_RAD),
      this.camera.position.z + 20 * Math.cos(CAMERA_PITCH_RAD),
    );
    this.cameraRig.localToWorld(_scratchVec);
    this.camera.lookAt(_scratchVec);
  }

  /**
   * Constant sinusoidal pitch + vertical bob, plus input-driven roll that
   * decays back to 0 when not steering.
   */
  private updateSpaceshipAnimation(dt: number): void {
    const t = performance.now() / 1000;
    const pitchAmp = 10;    // degrees
    const pitchFreq = 1;
    const bobAmp = 0.06;
    const bobFreq = 5;
    const rollAccel = 80;   // degrees per second when holding a direction
    const rollDecay = 60;   // degrees per second when releasing
    const maxRoll = 30;

    const pitch = pitchAmp * (Math.sin(pitchFreq * t) * 0.5 + 0.5);
    const bob = bobAmp * (Math.sin(bobFreq * t) * 0.5 + 0.5);

    // Unified tilt intent: +1 = tilt RIGHT, -1 = tilt LEFT, 0 = no input.
    //   keyAxis: LEFT=+1, RIGHT=-1. RIGHT should tilt right → intent = -keyAxis.
    //   swipe:   mouseDeltaX >0 = swipe right = tilt right → intent = sign(delta).
    // Keyboard takes precedence when both are active.
    let tiltIntent = 0;
    if (this.keyAxis !== 0) {
      tiltIntent = -this.keyAxis;
    } else if (this.frameSwipeDelta !== 0) {
      tiltIntent = Math.sign(this.frameSwipeDelta);
    }
    this.frameSwipeDelta = 0;

    if (tiltIntent !== 0) {
      // Positive intent (RIGHT) → positive currentRoll → positive Z rotation
      // on the wrapper → screen-right wing DOWN (see sign derivation for
      // keyboard above; same math).
      this.currentRoll += tiltIntent * rollAccel * dt;
    } else {
      // Decay toward 0.
      const step = rollDecay * dt;
      if (this.currentRoll > step) this.currentRoll -= step;
      else if (this.currentRoll < -step) this.currentRoll += step;
      else this.currentRoll = 0;
    }
    if (this.currentRoll > maxRoll) this.currentRoll = maxRoll;
    if (this.currentRoll < -maxRoll) this.currentRoll = -maxRoll;

    // Apply to the spaceship in player local space. We already lift the ship
    // by half-height + clearance in the constructor; bob just adds onto Y.
    const baseY = this.spaceship.position.y - this.lastBob;
    this.spaceship.position.y = baseY + bob;
    this.lastBob = bob;
    this.spaceship.rotation.set(
      THREE.MathUtils.degToRad(pitch),
      0,
      THREE.MathUtils.degToRad(this.currentRoll),
    );
  }
  private lastBob = 0;

  /** Build a basis with +Z = forward (look-along convention). */
  private applyForward(forward: THREE.Vector3): void {
    this._basisZ.copy(forward);
    this._basisX.crossVectors(this._up, this._basisZ).normalize();
    if (this._basisX.lengthSq() < 1e-8) this._basisX.set(1, 0, 0);
    this._basisY.crossVectors(this._basisZ, this._basisX);
    const m = _scratchMat;
    m.makeBasis(this._basisX, this._basisY, this._basisZ);
    this.root.quaternion.setFromRotationMatrix(m);
  }
}

const _scratchMat = new THREE.Matrix4();
const _scratchVec = new THREE.Vector3();
const CAMERA_PITCH_RAD = (15 * Math.PI) / 180;
const PIXELS_TO_INPUT_AXIS = 0.025;
/**
 * Lateral movement rate when a key is held (bitangent units per second).
 * Scaled up for the wider maxInputOffset
 * clamp so a tap still feels responsive. At 14 u/s, reaching the clamp (5)
 * takes ~0.36 seconds.
 */
const KEYBOARD_LATERAL_PER_SEC = 14;
/**
 * Rocket-fire min/max speed.
 * units behind the ship so those trails punch right through the camera. We
 * scale down to 0.5/2.0 for visual fidelity; reconcile in M11 if we add a
 * first-person camera option.
 */
const ROCKET_MIN_SPEED = 0.5;
const ROCKET_MAX_SPEED = 2.0;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
