import { GENESIS, exportGenerations, importGenerations, mergeGenerations } from './generations';
import { FREE_THROW } from './ball-play';
import { HALF_TICKS, PITCH, POSSESSION_TICKS, SHOT_TICKS, seededRandom } from './model';
import { INPUTS, observe, sample } from './policy';
import { assessPlay } from './referee';
import { CanoeMatch } from './simulation';
import { GenerationTrainer } from './training';

const idle = Array.from({ length: 10 }, () => ({ paddle: 0, ball: 0 }));

describe('Canoe polo simulation', () => {
  it('starts with two teams of five', () => {
    const { state } = new CanoeMatch(42);
    expect(state.players.filter((p) => p.team === 0)).toHaveLength(5);
    expect(state.players.filter((p) => p.team === 1)).toHaveLength(5);
    expect(state.ball.owner).toBeNull();
  });

  it('awards a goal only when the ball crosses the elevated opening', () => {
    const { state } = new CanoeMatch(42);
    state.ball.x = PITCH.length + 0.2;
    state.ball.y = PITCH.width / 2;
    state.ball.z = 2.5;
    const previous = { ...state.ball, x: PITCH.length - 0.2 };
    expect(assessPlay(state, previous)?.goal).toBe(0);
    state.ball.z = 0.11;
    expect(assessPlay(state, { ...previous, z: 0.11 })?.goal).toBeUndefined();
  });

  it('does not allow a direct goal from a restricted restart', () => {
    const { state } = new CanoeMatch(42);
    Object.assign(state.ball, {
      x: PITCH.length + 0.2,
      y: PITCH.width / 2,
      z: 2.5,
      restrictedThrower: 0,
    });
    expect(assessPlay(state, { ...state.ball, x: PITCH.length - 0.2 })?.goal).toBeUndefined();
  });

  it('awards the opponent a free shot for prolonged individual possession', () => {
    const match = new CanoeMatch(42);
    const s = match.state;
    s.ball.owner = 0;
    s.possessionTeam = 0;
    s.possessionTicks = POSSESSION_TICKS;
    expect(match.step(idle)?.kind).toBe('foul');
    expect(s.restart?.team).toBe(1);
    expect(s.phase).toBe('restart');
    expect(s.fouls[0]).toBe(1);
  });

  it('enforces the team shot clock', () => {
    const match = new CanoeMatch(42);
    match.state.possessionTeam = 1;
    match.state.shotTicks = SHOT_TICKS - 1;
    expect(match.step(idle)?.kind).toBe('foul');
    expect(match.state.restart?.team).toBe(0);
  });

  it('awards a throw-in to the team that did not last touch the ball', () => {
    const { state } = new CanoeMatch(42);
    state.ball.lastTouch = 0;
    state.ball.y = -1;
    expect(assessPlay(state, { ...state.ball, y: 0 })?.restart?.team).toBe(1);
  });

  it('changes ends at half time and ends after twenty minutes of play', () => {
    const match = new CanoeMatch(42);
    match.state.ticks = HALF_TICKS - 1;
    match.step(idle);
    expect(match.state.phase).toBe('half-time');
    for (let i = 0; i < 15; i++) match.step(idle);
    expect(match.state.half).toBe(2);
    expect(match.state.players[0].x).toBeGreaterThan(PITCH.length / 2);
    match.state.ticks = HALF_TICKS * 2 - 1;
    match.step(idle);
    expect(match.state.phase).toBe('finished');
  });

  it('reproduces the same simulation for the same seed and actions', () => {
    const a = new CanoeMatch(42);
    const b = new CanoeMatch(42);
    for (let i = 0; i < 300; i++) {
      a.step(idle);
      b.step(idle);
    }
    expect(a.state).toEqual(b.state);
  });
});

describe('Canoe polo learning and generations', () => {
  it('uses goal assistance only when enabled and only on a selected shot', () => {
    const { state } = new CanoeMatch(42);
    const p = state.players[0];
    state.ball.owner = p.id;
    expect(sample(GENESIS.weights, state, p, () => 0, true).action.goalAssist).toBeUndefined();
    const assisted = sample(GENESIS.weights, state, p, () => 0.999, true).action;
    expect(assisted).toMatchObject({ ball: FREE_THROW, goalAssist: true });
    expect(assisted.aim).toBeUndefined();
    expect(sample(GENESIS.weights, state, p, () => 0.999).action.goalAssist).toBeUndefined();
  });

  it('encodes a fixed-size observation and masks physically impossible ball actions', () => {
    const { state } = new CanoeMatch(42);
    const random = seededRandom(123);
    expect(observe(state, state.players[0])).toHaveLength(INPUTS);
    for (let i = 0; i < 10; i++) {
      expect(sample(GENESIS.weights, state, state.players[0], random).action.ball).toBeLessThan(2);
    }
  });

  it('updates policy weights from experience without modifying its parent', () => {
    const before = [...GENESIS.weights];
    const trainer = new GenerationTrainer(GENESIS, 42);
    trainer.runBatch();
    expect(trainer.weights).not.toEqual(before);
    expect(GENESIS.weights).toEqual(before);
    expect(trainer.progress.steps).toBeGreaterThan(0);
  });

  it('preserves the reward profile in exports and rejects out-of-range bonuses', () => {
    const generation = {
      ...GENESIS,
      id: 'round-trip-v2',
      parentId: GENESIS.id,
      number: 1,
      rewards: {
        winBall: 0,
        usefulPass: 0.42,
        receivePass: 0.12,
        saveGoal: 0.35,
        ignoreLooseBall: 0.02,
      },
    };
    expect(importGenerations(exportGenerations([generation]))).toEqual([generation]);
    const expanded = {
      ...generation,
      rewards: { ...generation.rewards, scoreGoal: 7.5, throwOut: 0 },
    };
    expect(importGenerations(exportGenerations([expanded]))).toEqual([expanded]);
    expect(() =>
      importGenerations(
        exportGenerations([{ ...expanded, rewards: { ...expanded.rewards, scoreGoal: 11 } }]),
      ),
    ).toThrow();
    expect(() =>
      importGenerations(
        exportGenerations([{ ...generation, rewards: { ...generation.rewards, winBall: 2 } }]),
      ),
    ).toThrow();
  });

  it('round trips the actual policy and rejects incompatible imports', () => {
    const encoded = exportGenerations([GENESIS]);
    expect(importGenerations(encoded)).toEqual([GENESIS]);
    expect(() =>
      importGenerations(encoded.replace('linear-actor-critic-v3', 'linear-actor-critic-v2')),
    ).toThrow();
    expect(() => importGenerations('{"format":"invalid"}')).toThrow();
    expect(mergeGenerations([GENESIS], [GENESIS])).toEqual([GENESIS]);
  });
});
