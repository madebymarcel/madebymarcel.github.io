import { describe, expect, it } from 'vitest';
import { RunningGait } from './running-gait';

function feed(gait: RunningGait, contacts: string) {
  for (const sample of contacts) {
    gait.observe(sample === 'L' || sample === 'B', sample === 'R' || sample === 'B');
  }
  return gait;
}

describe('Running gait detection', () => {
  it('rejects four two-foot hops with one-tick launch and landing offsets', () => {
    const gait = feed(new RunningGait(), 'BBBBBBLAAAAAAAAARBBBBBB'.repeat(4));
    expect(gait.alternating).toBe(0);
    expect(gait.otherFlights).toBe(4);
    expect(gait.qualifies(4)).toBe(false);
  });

  it('rejects a single-foot takeoff if the other foot touches down during the landing', () => {
    const gait = feed(new RunningGait(), 'LLLLLLLAAAAAAAAARRBBBBB');
    expect(gait.alternating).toBe(0);
    expect(gait.otherFlights).toBe(1);
  });

  it('accepts a sustained right-left-right running sequence', () => {
    const gait = feed(new RunningGait(), 'LLLLAAAAAAAAARRRRRRRAAAAAAAAALLLL');
    feed(gait, 'AAAAAAAARRRRAAAAAAAALLLL');
    expect(gait.alternating).toBe(4);
    expect(gait.otherFlights).toBe(0);
    expect(gait.qualifies(4)).toBe(true);
  });

  it('does not let occasional good strides qualify a run made mostly of hops', () => {
    const gait = feed(new RunningGait(), 'LLLLAAAARRRR'); // Below the flight threshold.
    feed(gait, 'LLLLLLLLAAAABBBBBB');
    expect(gait.otherFlights).toBe(0);
    feed(gait, 'LLLLLLLAAAAAAAAARRRRRRRAAAAAAAAALLLLAAAAAAAARRRRAAAAAAAALLLL');
    expect(gait.qualifies(4)).toBe(true);
    feed(gait, 'BBBBBBLAAAAAAAAARBBBBBB'.repeat(3));
    expect(gait.qualifies(4)).toBe(false);
  });

  it('does not count the same takeoff side repeatedly as a continuous alternating sequence', () => {
    const gait = feed(new RunningGait(), 'LLLLLLLAAAAAAAAARRRRRRR'.repeat(4));
    expect(gait.alternating).toBe(4);
    expect(gait.longestStreak).toBe(1);
    expect(gait.qualifies(4)).toBe(false);
  });

  it('ignores initial airborne time and ordinary contact flicker', () => {
    const gait = feed(new RunningGait(), 'AAAAAAAAAAALLLLALAALLLL');
    expect(gait.alternating).toBe(0);
    expect(gait.otherFlights).toBe(0);
  });
});
