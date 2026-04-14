/**
 * Scoring logic (no rendering) — the HUD lives in `pointsHud.ts` and observes
 * this manager.
 *
 *   BlockPicked: points += currentInc; currentInc = min(200, currentInc + 4)
 *   BlockMissed: points = max(0, points - 200);
 *                currentInc = max(1, currentInc - 50);
 *                if (currentInc % 2 == 0) currentInc++;
 *   ComputeTrackTotalPoints(blocksCount): same cumulative curve used to derive
 *                the theoretical max score if you pick every block.
 *
 * ORDER CAVEAT: the `-N` label spawned on a miss is `min(currentPoints, 200)`
 * — where `currentPoints` has ALREADY been decremented. So a player at 50
 * points who misses sees "-50", not "-200". Callers that render labels must
 * read `missLabelValue` from the `BlockMissed` return.
 */

export interface PickResult {
  pickedCount: number;
  currentPoints: number;
  awarded: number;
}

export interface MissResult {
  missedCount: number;
  currentPoints: number;
  /** Value to display in the floating "-N" label. */
  missLabelValue: number;
}

export class PointsManager {
  totalTrackPoints = 0;
  currentPoints = 0;
  pickedCount = 0;
  missedCount = 0;
  /** Display value for the most recent floating "+N" label (quirk — shows
   *  the POST-bump increment, i.e. the NEXT award). */
  lastPickLabelValue = 0;
  /** Display value for the most recent "-N" label. */
  lastMissLabelValue = 0;
  private currentIncrement = 1;

  /** Reset before starting a new song. */
  reset(): void {
    this.currentPoints = 0;
    this.pickedCount = 0;
    this.missedCount = 0;
    this.currentIncrement = 1;
  }

  /** Pre-compute the theoretical max score for the track. */
  computeTotal(blocksCount: number): void {
    this.totalTrackPoints = 0;
    let inc = 1;
    for (let i = 0; i < blocksCount; i++) {
      this.totalTrackPoints += inc;
      inc = Math.min(200, inc + 4);
    }
  }

  blockPicked(): PickResult {
    this.pickedCount++;
    const awarded = this.currentIncrement;
    this.currentPoints += awarded;
    this.currentIncrement = Math.min(200, this.currentIncrement + 4);
    // Quirk: label shows the POST-bump value.
    this.lastPickLabelValue = this.currentIncrement;
    return {
      pickedCount: this.pickedCount,
      currentPoints: this.currentPoints,
      awarded,
    };
  }

  blockMissed(): MissResult {
    this.missedCount++;
    this.currentPoints = Math.max(0, this.currentPoints - 200);
    this.currentIncrement = Math.max(1, this.currentIncrement - 50);
    if (this.currentIncrement % 2 === 0) this.currentIncrement++;
    // label reads POST-decrement currentPoints.
    const missLabelValue = Math.min(this.currentPoints, 200);
    this.lastMissLabelValue = missLabelValue;
    return {
      missedCount: this.missedCount,
      currentPoints: this.currentPoints,
      missLabelValue,
    };
  }

  /** Percent of theoretical max, or 0 before `computeTotal`. */
  get percentage(): number {
    if (this.totalTrackPoints <= 0) return 0;
    return (this.currentPoints / this.totalTrackPoints) * 100;
  }
}
