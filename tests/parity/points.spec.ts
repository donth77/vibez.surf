import { describe, expect, it } from 'vitest';
import { PointsManager } from '../../src/points/pointsManager';

describe('PointsManager — port of PointsManager.cs', () => {
  it('computes the theoretical total via the cumulative curve', () => {
    const pm = new PointsManager();
    pm.computeTotal(5);
    // Per C#: for i=0..blocksCount-1: total += inc; inc = min(200, inc + 4)
    // Initial inc=1. Sequence: 1,5,9,13,17 → sum = 45.
    expect(pm.totalTrackPoints).toBe(45);
  });

  it('caps the increment at 200', () => {
    const pm = new PointsManager();
    pm.computeTotal(100);
    // Increment sequence: 1,5,9,...,197,201→200,200,200,...
    // 50 blocks brings inc to 201→200 cap, remaining 50 all add 200.
    // Compute: first 50 picks (inc 1..197 step 4) = sum = 50*(1+197)/2 = 4950
    // Next 50 picks at 200 each = 10000.
    // Total = 14950.
    expect(pm.totalTrackPoints).toBe(14950);
  });

  it('blockPicked accumulates via the increment curve', () => {
    const pm = new PointsManager();
    pm.blockPicked();              // score += 1 → 1; inc: 1 → 5
    expect(pm.currentPoints).toBe(1);
    pm.blockPicked();              // score += 5 → 6; inc: 5 → 9
    expect(pm.currentPoints).toBe(6);
    pm.blockPicked();              // score += 9 → 15; inc: 9 → 13
    expect(pm.currentPoints).toBe(15);
  });

  it('blockMissed subtracts 200 (clamped) and drops increment by 50 with odd-bump', () => {
    const pm = new PointsManager();
    // Pump score up so subtraction is visible.
    for (let i = 0; i < 10; i++) pm.blockPicked();
    const before = pm.currentPoints;
    pm.blockMissed();
    expect(pm.currentPoints).toBe(Math.max(0, before - 200));
    // (increment is private but we can observe it through the next pick's label)
    const before2 = pm.currentPoints;
    pm.blockPicked();
    const awardedAfterMiss = pm.currentPoints - before2;
    // Before the miss: inc would have been 41 (after 10 picks: 1+4·10=41).
    // Miss: inc = max(1, 41-50) = 1 → odd-bump doesn't fire (1 is odd).
    // Next pick awards 1.
    expect(awardedAfterMiss).toBe(1);
  });

  it('clamps score at 0 on miss', () => {
    const pm = new PointsManager();
    pm.blockMissed(); // score stays at 0
    expect(pm.currentPoints).toBe(0);
  });

  it('label values match the C# source quirks', () => {
    const pm = new PointsManager();
    pm.blockPicked();
    // Post-bump increment = 5 → label reads "+5" for the FIRST pick (even though
    // the score only went up by 1). This is a source quirk we mirror.
    expect(pm.lastPickLabelValue).toBe(5);

    // Miss label = min(currentPoints, 200) AFTER decrement.
    pm.blockMissed();
    expect(pm.lastMissLabelValue).toBe(Math.min(pm.currentPoints, 200));
  });
});
