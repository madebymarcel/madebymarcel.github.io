import { FIRST_PASS, FREE_THROW, launchBall } from './ball-play';
import { PITCH } from './model';
import { CanoeMatch } from './simulation';
import { ballControlReward } from './training';

function setup() {
  const match = new CanoeMatch(42);
  const s = match.state;
  Object.assign(s.players[0], { x: 10, y: 9.3 });
  Object.assign(s.players[1], { x: 15, y: 10, heading: Math.PI });
  s.ball.owner = 0;
  s.ball.lastTouch = 0;
  s.possessionTeam = 0;
  match.refreshVision();
  return { match, s };
}

function play(match: CanoeMatch, actions: Record<number, number>) {
  return match.step(match.state.players.map((p) => ({ paddle: 0, ball: actions[p.id] ?? 0 })));
}

describe('Aimed ball play', () => {
  it('aims at a moving teammate without rounding to a fixed direction', () => {
    const { match, s } = setup();
    const pass = launchBall(s, s.players[0], { paddle: 0, ball: FIRST_PASS })!;
    expect(pass.target).toBe(1);
    expect(pass.vy / pass.vx).toBeCloseTo(0.7 / 5);
    s.players[1].vy = 1;
    match.refreshVision();
    const led = launchBall(s, s.players[0], { paddle: 0, ball: FIRST_PASS })!;
    expect(led.vy / led.vx).toBeGreaterThan(pass.vy / pass.vx);
    const aim = 0.12345;
    const free = launchBall(s, s.players[0], {
      paddle: 0,
      ball: FREE_THROW,
      aim,
      power: 0.5,
      loft: 0.5,
    })!;
    expect(Math.atan2(free.vy, free.vx)).toBeCloseTo(aim, 10);
    expect(Math.hypot(free.vx, free.vy)).toBeCloseTo(5.5 * Math.cos(0.5));
  });

  it('completes an open pass and rewards the passer and receiver, not other players', () => {
    const { match, s } = setup();
    play(match, { 0: FIRST_PASS });
    for (let i = 0; i < 10 && s.ball.owner === null; i++) play(match, { 1: 1 });
    expect(s.ball.owner).toBe(1);
    const pass = match.lastBallPlay;
    expect(pass).toMatchObject({ kind: 'pass', from: 0, receiver: 1, progressive: true });
    expect(ballControlReward(pass, 0)).toBeGreaterThan(ballControlReward(pass, 1));
    expect(ballControlReward(pass, 1)).toBeGreaterThan(0);
    expect(ballControlReward(pass, 2)).toBe(0);

    play(match, { 1: FIRST_PASS });
    for (let i = 0; i < 10 && s.ball.owner === null; i++) play(match, { 0: 1 });
    expect(match.lastBallPlay).toMatchObject({ kind: 'pass', progressive: false });
    expect(ballControlReward(match.lastBallPlay, 1)).toBe(0);
  });

  it('lets a defender intercept a pass and rewards only the interception', () => {
    const { match, s } = setup();
    Object.assign(s.players[5], { x: 12.5, y: 9.65 });
    play(match, { 0: FIRST_PASS });
    for (let i = 0; i < 10 && s.ball.owner === null; i++) play(match, { 1: 1, 5: 1 });
    expect(s.ball.owner).toBe(5);
    expect(match.lastBallPlay).toMatchObject({ kind: 'interception', from: 0, receiver: 5 });
    expect(ballControlReward(match.lastBallPlay, 0)).toBe(0);
    expect(ballControlReward(match.lastBallPlay, 5)).toBeGreaterThan(0);
  });

  it('can score a legal shot without bypassing elevated goal detection', () => {
    const { match, s } = setup();
    Object.assign(s.players[0], { x: PITCH.length - 8, y: PITCH.width / 2 - 2 });
    match.step(
      s.players.map((p) => ({
        paddle: 0,
        ball: p.id === 0 ? FREE_THROW : 0,
        aim: Math.atan2(2, 8.11),
        power: 1,
        loft: 0.55,
      })),
    );
    for (let i = 0; i < 12 && s.score[0] === 0; i++) play(match, {});
    expect(s.score).toEqual([1, 0]);
  });
});
