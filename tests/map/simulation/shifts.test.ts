import { describe, it, expect } from 'vitest';
import { isShiftOver, isNearShiftStart } from '@/map/cars';

describe('isNearShiftStart', () => {
  it.each([
    [7, 8, true],    // 1 hour before
    [8, 8, true],    // exactly at start
    [6, 8, true],    // 2 hours before
    [5, 8, false],   // 3 hours before
    [10, 8, true],   // 2 hours after (boundary, still in window)
    [11, 8, false],  // 3 hours after
    [12, 8, false],  // well past
  ])('hour=%d, shiftStart=%d → %s (day shift)', (hour, shiftStart, expected) => {
    expect(isNearShiftStart(hour, shiftStart)).toBe(expected);
  });

  it.each([
    [21, 22, true],  // 1 hour before night shift
    [22, 22, true],  // exactly at start
    [20, 22, true],  // 2 hours before
    [19, 22, false], // 3 hours before
    [0, 22, true],   // 2 hours after (still in arrival window)
  ])('hour=%d, shiftStart=%d → %s (night shift)', (hour, shiftStart, expected) => {
    expect(isNearShiftStart(hour, shiftStart)).toBe(expected);
  });

  it('handles midnight wraparound for early morning shift', () => {
    // shiftStart=2, checking from hour=0 (2 hours before)
    expect(isNearShiftStart(0, 2)).toBe(true);
    // shiftStart=2, checking from hour=23 (3 hours before, wrapping)
    expect(isNearShiftStart(23, 2)).toBe(false);
  });
});

describe('isShiftOver', () => {
  describe('day shift (end > start)', () => {
    it.each([
      [17, 17, 8, true],   // exactly at end
      [18, 17, 8, true],   // past end
      [16, 17, 8, false],  // before end
      [12, 17, 8, false],  // mid-shift
      [8, 17, 8, false],   // at start (near shift start, so not over)
    ])('hour=%d, shiftEnd=%d, shiftStart=%d → %s', (hour, shiftEnd, shiftStart, expected) => {
      expect(isShiftOver(hour, shiftEnd, shiftStart)).toBe(expected);
    });
  });

  describe('night shift (end < start, e.g. 22-6)', () => {
    it.each([
      [6, 6, 22, true],    // exactly at end
      [7, 6, 22, true],    // past end
      [3, 6, 22, false],   // mid-shift (after midnight)
      [23, 6, 22, false],  // mid-shift (before midnight)
      [0, 6, 22, false],   // mid-shift
      [5, 6, 22, false],   // just before end
    ])('hour=%d, shiftEnd=%d, shiftStart=%d → %s', (hour, shiftEnd, shiftStart, expected) => {
      expect(isShiftOver(hour, shiftEnd, shiftStart)).toBe(expected);
    });
  });

  it('shift is never over during near-shift-start window', () => {
    // shiftStart=8, hour=7 is near shift start
    // Even if shiftEnd=6 would normally mean "over", the pre-shift window blocks it
    expect(isShiftOver(7, 6, 8)).toBe(false);
  });

});
