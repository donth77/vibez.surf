import { BLOCKS_DEFAULTS, type BlocksManager } from './blocksManager';
import type { PointsManager } from '../points/pointsManager';

/**
 * Collision detector — swept-sphere approximation against each block.
 *
 * A swept sphere catches any *instantaneous* touch: you can brush a block
 * with the ship and immediately dodge to the next lane, and the pick still
 * registers. Sampling once at "the frame where endP is crossed" misses
 * those brief overlaps.
 *
 * We approximate the sweep by tracking the MINIMUM lateral distance observed
 * while each block is inside a small percentage window around its endP. If
 * that minimum ever drops below the pick threshold, we fire a pick when the
 * window expires; otherwise a miss.
 *
 * Pick/miss sphere params:
 *   pickSphereRadius = 0.3, missSphereRadius = 10.
 * Effective lateral pick threshold = pickRadius + blockHalfWidth
 *                                  = 0.3 + 0.75/2 = 0.675
 */

export interface CollisionCallbacks {
  onPick(blockIndex: number, lane: -1 | 0 | 1, time: number): void;
  onMiss(blockIndex: number, lane: -1 | 0 | 1, time: number): void;
}

/**
 * Authoritative prefab value was 0.3 (threshold 0.675). Bumped modestly for
 * more forgiving pickups. Effective threshold = 0.6 + 0.75/2 = 0.975 lateral
 * units (vs ±2.2 lane spacing, ~44% of the half-gap as a pick zone).
 */
const PICK_SPHERE_RADIUS = 0.6;

interface ActiveEntry {
  blockIndex: number;
  endP: number;
  zOffset: number;
  lane: -1 | 0 | 1;
  minLateral: number;
}

export class BlockCollisionSweep {
  private readonly sortedIndices: number[];
  /** Cursor into `sortedIndices`: blocks before this have been activated. */
  private activateCursor = 0;
  /** Blocks currently in the collision window, ordered by endP. */
  private active: ActiveEntry[] = [];
  private readonly pickThreshold: number;
  /**
   * Activation window size in percentage-of-song. The ship passes through a
   * block's endP region over roughly ship_length / total_track_length, which
   * for the default setup is tiny (~1.3 / ~10000 ≈ 0.00013). We use a
   * slightly wider window so that 2–3 frames of lateral motion are always
   * sampled, matching what a true swept sphere would catch.
   */
  private readonly windowBefore = 0.0003;
  private readonly windowAfter = 0.0003;

  constructor(
    private readonly blocks: BlocksManager,
    private readonly points: PointsManager,
    pickSphereRadius = PICK_SPHERE_RADIUS,
  ) {
    const blockHalfZ = BLOCKS_DEFAULTS.blockSize.z / 2;
    this.pickThreshold = pickSphereRadius + blockHalfZ;

    const entries = blocks.entriesForTest;
    const indices = Array.from({ length: entries.length }, (_, i) => i);
    indices.sort((a, b) => entries[a]!.endP - entries[b]!.endP);
    this.sortedIndices = indices;
  }

  update(
    currentP: number,
    playerLateralZ: number,
    time: number,
    cb?: Partial<CollisionCallbacks>,
  ): void {
    const entries = this.blocks.entriesForTest;

    // 1. Activate blocks that have entered the window.
    while (this.activateCursor < this.sortedIndices.length) {
      const idx = this.sortedIndices[this.activateCursor]!;
      const e = entries[idx]!;
      if (e.endP > currentP + this.windowBefore) break;
      this.active.push({
        blockIndex: idx,
        endP: e.endP,
        zOffset: e.zOffset,
        lane: e.lane,
        minLateral: Math.abs(playerLateralZ - e.zOffset),
      });
      this.activateCursor++;
    }

    // 2. Update min lateral distance for all still-active blocks.
    for (const a of this.active) {
      const d = Math.abs(playerLateralZ - a.zOffset);
      if (d < a.minLateral) a.minLateral = d;
    }

    // 3. Resolve blocks whose window has now passed.
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < this.active.length; readIdx++) {
      const a = this.active[readIdx]!;
      if (currentP > a.endP + this.windowAfter) {
        if (a.minLateral < this.pickThreshold) {
          this.points.blockPicked();
          this.blocks.pick(a.blockIndex, time);
          cb?.onPick?.(a.blockIndex, a.lane, time);
        } else {
          this.points.blockMissed();
          cb?.onMiss?.(a.blockIndex, a.lane, time);
        }
      } else {
        this.active[writeIdx++] = a;
      }
    }
    this.active.length = writeIdx;
  }

  reset(): void {
    this.activateCursor = 0;
    this.active.length = 0;
  }
}
