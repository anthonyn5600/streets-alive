import { describe, it, expect, beforeEach } from 'vitest';
import { SimClock } from '@/map/simulation/clock';

let clock: SimClock;

beforeEach(() => {
  clock = new SimClock();
});

describe('SimClock initial state', () => {
  it('starts at time 0 (hour 0, minute 0, day 1)', () => {
    expect(clock.simTime).toBe(0);
    expect(clock.getHour()).toBe(0);
    expect(clock.getMinute()).toBe(0);
    expect(clock.getDay()).toBe(1);
  });
});

describe('SimClock.update', () => {
  it('advances simTime by realDelta * 120', () => {
    clock.update(1.0);
    expect(clock.simTime).toBe(120);
  });

  it('accumulates across multiple updates', () => {
    clock.update(0.5);
    clock.update(0.5);
    expect(clock.simTime).toBe(120);
  });

  it('returns true when formatted time changes', () => {
    // At simTime=0 format is "12:00 AM". After 1 real second = 120 sim sec = 2 min,
    // format becomes "12:02 AM" — different, so returns true.
    const changed = clock.update(1.0);
    expect(changed).toBe(true);
  });

  it('returns false when formatted time has not changed', () => {
    clock.update(1.0); // "12:02 AM"
    // Tiny increment: 0.001 real sec = 0.12 sim sec — still "12:02 AM"
    const changed = clock.update(0.001);
    expect(changed).toBe(false);
  });
});

describe('SimClock.getHour', () => {
  it.each([
    [0, 0],
    [3600, 1],
    [43200, 12],
    [82800, 23],
    [86400, 0],   // wraps at midnight
    [90000, 1],   // 1 AM next day
  ])('returns correct hour for simTime %d', (simTime, expectedHour) => {
    clock.simTime = simTime;
    expect(clock.getHour()).toBe(expectedHour);
  });
});

describe('SimClock.getMinute', () => {
  it.each([
    [0, 0],
    [60, 1],
    [1800, 30],
    [3540, 59],
    [3600, 0],    // resets at hour boundary
  ])('returns correct minute for simTime %d', (simTime, expectedMinute) => {
    clock.simTime = simTime;
    expect(clock.getMinute()).toBe(expectedMinute);
  });
});

describe('SimClock.getDay', () => {
  it.each([
    [0, 1],
    [86399, 1],
    [86400, 2],
    [172800, 3],
  ])('returns correct day for simTime %d', (simTime, expectedDay) => {
    clock.simTime = simTime;
    expect(clock.getDay()).toBe(expectedDay);
  });
});

describe('SimClock.getHourFraction', () => {
  it('returns 0.0 at midnight', () => {
    clock.simTime = 0;
    expect(clock.getHourFraction()).toBe(0);
  });

  it('returns 12.5 at 12:30 PM', () => {
    clock.simTime = 12 * 3600 + 30 * 60;
    expect(clock.getHourFraction()).toBeCloseTo(12.5);
  });

  it('wraps within 0-24 across days', () => {
    clock.simTime = 86400 + 6 * 3600; // day 2, 6 AM
    expect(clock.getHourFraction()).toBeCloseTo(6.0);
  });
});

describe('SimClock.formatTime', () => {
  it.each([
    [0, '12:00 AM'],
    [3600, '1:00 AM'],
    [43200, '12:00 PM'],
    [46800, '1:00 PM'],
    [82800, '11:00 PM'],
    [3600 + 1800, '1:30 AM'],
  ])('formats simTime %d as %s', (simTime, expected) => {
    clock.simTime = simTime;
    expect(clock.formatTime()).toBe(expected);
  });
});

describe('SimClock.formatFull', () => {
  it('includes day and time', () => {
    clock.simTime = 0;
    expect(clock.formatFull()).toBe('Day 1, 12:00 AM');
  });

});

describe('SimClock real-time mapping', () => {
  it('30 real seconds equals 1 sim hour', () => {
    clock.update(30);
    expect(clock.getHour()).toBe(1);
    expect(clock.getMinute()).toBe(0);
  });

  it('720 real seconds (12 min) equals 1 sim day', () => {
    clock.update(720);
    expect(clock.getDay()).toBe(2);
    expect(clock.getHour()).toBe(0);
  });
});
