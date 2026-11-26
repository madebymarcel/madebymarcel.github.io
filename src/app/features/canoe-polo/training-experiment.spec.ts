import { probeShootingPose } from './training-experiment';

describe('Canoe Polo shooting experiment', () => {
  it('counts available scoring actions through the real scoring rules', () => {
    const pose = { distance: 4, angle: 0, lateral: 0, moving: false, seed: 42 };
    expect(probeShootingPose(pose)).toBeGreaterThan(0);
    expect(probeShootingPose({ ...pose, distance: 12 })).toBe(0);
  });
});
