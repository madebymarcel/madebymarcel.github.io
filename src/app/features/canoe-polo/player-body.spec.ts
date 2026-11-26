import { FIRST_PASS, FREE_THROW, launchBall } from './ball-play';
import { GENESIS } from './generations';
import { PITCH, seededRandom, type Action } from './model';
import { canSee, turnHead } from './player-body';
import { observe, sample } from './policy';
import { CanoeMatch } from './simulation';
import { evaluateDrills } from './skills-drills';
import { ballControlReward } from './training';

const idle: Action = { paddle: 0, ball: 0 };

describe('Player perception and body', () => {
  it('does not leak hidden movement through observations, pass choices, or the throw vector', () => {
    const m = new CanoeMatch(42);
    const s = m.state;
    const p = s.players[0];
    const receiver = s.players[1];
    Object.assign(p, { x: 12, y: 11, heading: 0, headTurn: 0 });
    Object.assign(receiver, { x: 16, y: 11 });
    Object.assign(s.ball, { owner: 0, x: 12, y: 11 });
    m.refreshVision();
    p.headTurn = -1.25;
    m.refreshVision();
    const before = observe(s, p);
    const draw = sample(GENESIS.weights, s, p, seededRandom(8));
    const oldPass = launchBall(s, p, { ...idle, ball: FIRST_PASS });
    expect(oldPass).not.toBeNull();
    receiver.x = 18;
    receiver.y = 13;
    m.refreshVision();
    expect(observe(s, p)).toEqual(before);
    expect(sample(GENESIS.weights, s, p, seededRandom(8))).toEqual(draw);
    expect(launchBall(s, p, { ...idle, ball: FIRST_PASS })).toEqual(oldPass);
    for (let i = 0; i < 5; i++) turnHead(p, 0);
    m.refreshVision();
    expect(canSee(p, receiver)).toBe(true);
    expect(launchBall(s, p, { ...idle, ball: FIRST_PASS })).not.toEqual(oldPass);
    p.headTurn = -1.25;
    s.ticks += 12;
    m.refreshVision();
    expect(launchBall(s, p, { ...idle, ball: FIRST_PASS })).toBeNull();
  });

  it('throws less far with the other hand and stops two-handed strokes while holding', () => {
    const m = new CanoeMatch(42);
    const { state: s } = m;
    const p = s.players[0];
    const strong = launchBall(s, p, { ...idle, ball: FREE_THROW, hand: 1 })!;
    const weak = launchBall(s, p, { ...idle, ball: FREE_THROW, hand: -1 })!;
    expect(Math.hypot(strong.vx, strong.vy)).toBeGreaterThan(Math.hypot(weak.vx, weak.vy));
    s.ball.owner = p.id;
    p.stroke = 1;
    p.strokeTicks = 3;
    m.step(s.players.map(() => ({ paddle: 1, ball: 0 })));
    expect(p.strokeTicks).toBe(0);
    expect(p.vx).toBe(0);
  });

  it('a poorly aimed close shot can go out', () => {
    const m = new CanoeMatch(42);
    const { state: s } = m;
    Object.assign(s.players[0], { x: PITCH.length - 3, y: PITCH.width / 2 });
    Object.assign(s.ball, { owner: 0, lastTouch: 0 });
    m.step(
      s.players.map((p) =>
        p.id === 0 ? { ...idle, ball: FREE_THROW, aim: 1.0, power: 1, loft: 0.55 } : idle,
      ),
    );
    for (let i = 0; i < 15 && s.phase === 'play'; i++) m.step(s.players.map(() => idle));
    expect(s.score).toEqual([0, 0]);
    expect(s.events.some((e) => e.kind === 'out')).toBe(true);
  });

  it('rewards a goal-bound catch more than an ordinary interception', () => {
    const m = new CanoeMatch(7);
    const s = m.state;
    const keeper = s.players[5];
    Object.assign(keeper, { x: 33.9, y: PITCH.width / 2, heading: Math.PI });
    Object.assign(s.ball, {
      x: 32.7,
      y: PITCH.width / 2,
      z: 2.48,
      vx: 8,
      vy: 0,
      vz: 1.5,
      lastTouch: 0,
    });
    s.possessionTeam = 0;
    m.step(s.players.map((p) => (p.id === keeper.id ? { ...idle, ball: 1 } : idle)));
    const save = m.lastBallPlay;
    expect(save).toMatchObject({ receiver: 5, kind: 'interception', save: true });
    expect(ballControlReward(save, 5)).toBeGreaterThan(
      ballControlReward({ ...save!, save: false }, 5),
    );
    expect(ballControlReward(save, 6)).toBe(0);
  });

  it('faces sideline restarts into the pitch', () => {
    for (const y of [0, PITCH.width]) {
      const m = new CanoeMatch(42);
      const s = m.state;
      s.phase = 'restart';
      s.restart = { x: 10, y, team: 0, ticks: 1, kind: 'free-throw' };
      m.step(s.players.map(() => idle));
      const p = s.players[s.ball.owner!];
      expect(Math.sin(p.heading)).toBeCloseTo(y === 0 ? 1 : -1);
      const throwIn = launchBall(s, p, { ...idle, ball: FREE_THROW });
      expect(throwIn!.vy * (y === 0 ? 1 : -1)).toBeGreaterThan(0);
    }
  });

  it('keeps diagnostic trials repeatable and independent of training', () => {
    const weights = [...GENESIS.weights];
    const results = evaluateDrills(weights);
    expect(results).toEqual(evaluateDrills(weights));
    expect(Object.keys(results)).toEqual(['collect', 'shoot', 'save']);
    expect(weights).toEqual(GENESIS.weights);
  });
});
