import { describe, expect, it } from 'vitest';
import { removeNearBeats } from '../../src/blocks/blocksManager';

describe('removeNearBeats — port of BlocksManager.RemoveNearBeats', () => {
  it('keeps high beats that are far from any low beat', () => {
    expect(removeNearBeats([0, 100], [50], 5)).toEqual([50]);
  });

  it('drops high beats within the source half-open range', () => {
    // Source's `ListContainsInRange`: `for (i = toCheck-range; i < toCheck+range; i++)`.
    // The base beat (10) lies in [toCheck-5, toCheck+5) iff
    //   toCheck-5 ≤ 10 < toCheck+5  →  6 ≤ toCheck ≤ 15  →  highBeat dropped.
    // Below 6 or above 15 → kept.
    expect(removeNearBeats([10], [12], 5)).toEqual([]);   // dropped (in window)
    expect(removeNearBeats([10], [15], 5)).toEqual([]);   // dropped (upper bound)
    expect(removeNearBeats([10], [6], 5)).toEqual([]);    // dropped (lower bound)
    expect(removeNearBeats([10], [5], 5)).toEqual([5]);   // kept (just outside)
    expect(removeNearBeats([10], [16], 5)).toEqual([16]); // kept (just outside)
    expect(removeNearBeats([10], [4], 5)).toEqual([4]);   // kept
  });

  it('returns a copy when low is empty', () => {
    const high = [1, 2, 3];
    const out = removeNearBeats([], high, 5);
    expect(out).toEqual(high);
    expect(out).not.toBe(high);
  });
});
