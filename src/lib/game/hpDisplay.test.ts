import { describe, expect, it } from 'vitest';
import { remainingHp } from './hpDisplay';

describe('remainingHp', () => {
  it('projects HP after queued damage counters', () => {
    expect(remainingHp(210, 130, 40)).toBe(40);
    expect(remainingHp(210, 130, 80)).toBe(0);
  });

  it('clamps healing-style negative deltas to printed HP', () => {
    expect(remainingHp(210, 130, -40)).toBe(120);
    expect(remainingHp(210, 10, -40)).toBe(210);
  });

  it('handles unavailable HP defensively', () => {
    expect(remainingHp(0, 30, 10)).toBe(0);
    expect(remainingHp(Number.NaN, 30, 10)).toBe(0);
  });
});
