import { PITCH } from './model';
import { stepPaddle, STROKE_TICKS } from './paddle';
import { CanoeMatch } from './simulation';

function boat() {
  return { ...new CanoeMatch(42).state.players[0], x: PITCH.length / 2, y: PITCH.width / 2 };
}

describe('Finite paddle strokes', () => {
  it('produces mirrored left and right turns and moves forward for either stroke', () => {
    const left = boat();
    const right = boat();
    for (let i = 0; i < STROKE_TICKS; i++) {
      stepPaddle(left, 1);
      stepPaddle(right, 2);
    }
    expect(left.x).toBeGreaterThan(PITCH.length / 2);
    expect(left.x).toBeCloseTo(right.x);
    expect(left.heading).toBeGreaterThan(0);
    expect(left.heading).toBeCloseTo(-right.heading);
  });

  it('finishes a stroke before accepting another, then coasts with drag', () => {
    const a = boat();
    const b = boat();
    stepPaddle(a, 1);
    stepPaddle(b, 1);
    for (let i = 1; i < STROKE_TICKS; i++) {
      stepPaddle(a, 2);
      stepPaddle(b, 1);
    }
    expect(a).toEqual(b);
    const speed = Math.hypot(a.vx, a.vy);
    stepPaddle(a, 0);
    expect(Math.hypot(a.vx, a.vy)).toBeLessThan(speed);
    expect(a.vx).toBeGreaterThan(0);
  });

  it('can reverse heading within a buoy-sized area with alternating sweeps', () => {
    const player = boat();
    const { x, y } = player;
    let maxDistance = 0;
    for (let i = 0; i < 40 && player.heading < Math.PI; i++) {
      stepPaddle(player, Math.floor(i / STROKE_TICKS) % 2 === 0 ? 3 : 6);
      maxDistance = Math.max(maxDistance, Math.hypot(player.x - x, player.y - y));
    }
    expect(player.heading).toBeGreaterThanOrEqual(Math.PI);
    expect(maxDistance).toBeLessThan(2);
  });
});
