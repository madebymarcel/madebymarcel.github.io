import { FIRST_PASS, FREE_THROW, launchBall } from './ball-play';
import { BALL_RADIUS, PITCH, seededRandom } from './model';
import { PADDLE_PICKUP_REACH } from './paddle';
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

describe('Loose-ball pickups', () => {
  function crossing() {
    const match = new CanoeMatch(42);
    const { ball, players } = match.state;
    const p = players[0];
    Object.assign(p, { x: 10, y: 11.5, heading: 0, vx: 3.5 });
    Object.assign(ball, { x: 10.25, y: 11.5, z: BALL_RADIUS });
    return { match, ball, p };
  }

  it('allows an intentional reach before a coasting boat overshoots a water ball in one tick', () => {
    const { match, ball, p } = crossing();
    play(match, { 0: 1 });
    expect(p.x).toBeGreaterThan(10.25);
    expect(ball.owner).toBe(p.id);
    expect(match.lastBallPlay).toMatchObject({ kind: 'claim', receiver: p.id });
  });

  it('does not collect the ball just by running over it', () => {
    const { match, ball, p } = crossing();
    play(match, {});
    expect(p.x).toBeGreaterThan(ball.x);
    expect(ball.owner).toBeNull();
  });

  it('lets a paddler interrupt a stroke to collect a water ball', () => {
    const { match, ball, p } = crossing();
    Object.assign(p, { stroke: 1, strokeTicks: 3 });
    play(match, { 0: 1 });
    expect(ball.owner).toBe(p.id);
    expect(p.strokeTicks).toBe(0);
  });

  it('can pick up a water ball behind the boat if it is within paddle reach', () => {
    const { match, ball, p } = crossing();
    p.vx = 0;
    ball.x = p.x - PADDLE_PICKUP_REACH + 0.01;
    play(match, { 0: 1 });
    expect(ball.owner).toBe(p.id);
  });

  it('does not pick up a water ball outside paddle reach', () => {
    const { match, ball, p } = crossing();
    p.vx = 0;
    ball.y = p.y + PADDLE_PICKUP_REACH + 0.01;
    play(match, { 0: 1 });
    expect(ball.owner).toBeNull();
  });

  it('does not apply the aerial catch miss chance to a reachable water pickup', () => {
    const seed = 1600;
    expect(seededRandom(seed)()).toBeGreaterThan(0.85);
    const match = new CanoeMatch(seed);
    const { ball, players } = match.state;
    const p = players[0];
    Object.assign(ball, { x: p.x + 0.6, y: p.y });
    play(match, { 0: 1 });
    expect(ball.owner).toBe(p.id);
  });

  it('still requires a free hand for airborne catches', () => {
    const { match, ball, p } = crossing();
    Object.assign(p, { vx: 0, stroke: 1, strokeTicks: 3 });
    Object.assign(ball, { x: p.x + 0.75, z: 1.2 });
    play(match, { 0: 1 });
    expect(ball.owner).toBeNull();
  });

  it('does not turn a ball that goes out in the same tick into possession', () => {
    const { match, ball, p } = crossing();
    Object.assign(p, { y: 0.65 });
    Object.assign(ball, { y: 0.08, vy: -2 });
    expect(play(match, { 0: 1 })?.kind).toBe('out');
    expect(match.lastBallPlay).toBeNull();
  });
});

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
