import {
  HALF_TICKS,
  PITCH,
  POSSESSION_TICKS,
  SHOT_TICKS,
  attackDirection,
  clamp,
  seededRandom,
  type Action,
  type MatchState,
  type Player,
} from './model';

export const INPUTS = 56;
export const PADDLE_ACTIONS = 7;
export const BALL_ACTIONS = 34;
const VALUE_ROW = PADDLE_ACTIONS + BALL_ACTIONS;
export const WEIGHT_COUNT = (VALUE_ROW + 1) * INPUTS;
export const POLICY_VERSION = 'linear-actor-critic-v1';

export interface PolicySample {
  observation: number[];
  action: Action;
  paddles: number[];
  balls: number[];
  value: number;
}

export function initialWeights(seed = 42): number[] {
  const random = seededRandom(seed);
  return Array.from({ length: WEIGHT_COUNT }, () => (random() - 0.5) * 0.04);
}

export function observe(state: MatchState, player: Player): number[] {
  const direction = attackDirection(player.team, state.half);
  const ball = state.ball;
  const owner = ball.owner === null ? null : state.players[ball.owner];
  const attackX = direction === 1 ? player.x : PITCH.length - player.x;
  const attackY = direction === 1 ? player.y : PITCH.width - player.y;
  const input = [
    1,
    attackX / PITCH.length,
    attackY / PITCH.width,
    Math.cos(player.heading) * direction,
    Math.sin(player.heading) * direction,
    (player.vx * direction) / 3.5,
    (player.vy * direction) / 3.5,
    ((ball.x - player.x) * direction) / PITCH.length,
    ((ball.y - player.y) * direction) / PITCH.width,
    ball.z / 4,
    (ball.vx * direction) / 11,
    (ball.vy * direction) / 11,
    Number(owner?.id === player.id),
    Number(owner?.team === player.team),
    Number(owner !== null && owner.team !== player.team),
    owner?.id === player.id ? state.possessionTicks / POSSESSION_TICKS : 0,
    state.shotTicks / SHOT_TICKS,
    clamp((state.score[player.team] - state.score[player.team === 0 ? 1 : 0]) / 5, -1, 1),
    1 - state.ticks / (2 * HALF_TICKS),
    Number(ball.restrictedThrower === player.id),
  ];
  // Teammates first, then opponents, in stable roster order.
  const others = [
    ...state.players.filter((p) => p.id !== player.id && p.team === player.team),
    ...state.players.filter((p) => p.team !== player.team),
  ];
  for (const p of others) {
    input.push(
      ((p.x - player.x) * direction) / PITCH.length,
      ((p.y - player.y) * direction) / PITCH.width,
      (p.vx * direction) / 3.5,
      (p.vy * direction) / 3.5,
    );
  }
  return input;
}

function dot(weights: readonly number[], observation: readonly number[], row: number): number {
  let value = 0;
  const offset = row * INPUTS;
  for (let i = 0; i < INPUTS; i++) value += weights[offset + i] * observation[i];
  return value;
}

function probabilities(
  weights: readonly number[],
  input: readonly number[],
  offset: number,
  count: number,
  allowed: (index: number) => boolean,
): number[] {
  const logits = Array.from({ length: count }, (_, i) =>
    allowed(i) ? dot(weights, input, offset + i) : -Infinity,
  );
  const max = Math.max(...logits);
  const exp = logits.map((value) => Math.exp(value - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((value) => value / sum);
}

function choose(probability: readonly number[], random: () => number): number {
  let remaining = random();
  for (let i = 0; i < probability.length; i++) {
    remaining -= probability[i];
    if (remaining < 0) return i;
  }
  for (let i = probability.length - 1; i >= 0; i--) {
    if (probability[i] > 0) return i;
  }
  return 0;
}

export function sample(
  weights: readonly number[],
  state: MatchState,
  player: Player,
  random: () => number,
): PolicySample {
  const observation = observe(state, player);
  const paddles = probabilities(weights, observation, 0, PADDLE_ACTIONS, () => true);
  const hasBall = state.ball.owner === player.id;
  const balls = probabilities(
    weights,
    observation,
    PADDLE_ACTIONS,
    BALL_ACTIONS,
    (i) => i === 0 || (hasBall ? i >= 2 : i === 1),
  );
  return {
    observation,
    paddles,
    balls,
    action: { paddle: choose(paddles, random), ball: choose(balls, random) },
    value: dot(weights, observation, VALUE_ROW),
  };
}

export function estimateValue(weights: readonly number[], state: MatchState, p: Player): number {
  return dot(weights, observe(state, p), VALUE_ROW);
}

export function addGradient(
  gradient: Float64Array,
  decision: PolicySample,
  target: number,
): void {
  const advantage = clamp(target - decision.value, -5, 5);
  const accumulate = (row: number, scale: number): void => {
    for (let i = 0; i < INPUTS; i++) {
      gradient[row * INPUTS + i] += scale * decision.observation[i];
    }
  };
  decision.paddles.forEach((prob, i) => {
    accumulate(i, advantage * (Number(i === decision.action.paddle) - prob));
  });
  decision.balls.forEach((prob, i) => {
    accumulate(PADDLE_ACTIONS + i, advantage * (Number(i === decision.action.ball) - prob));
  });
  accumulate(VALUE_ROW, 0.5 * advantage);
}
