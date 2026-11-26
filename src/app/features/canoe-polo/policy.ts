import {
  HALF_TICKS,
  PITCH,
  POSSESSION_TICKS,
  SHOT_TICKS,
  attackDirection,
  clamp,
  distance,
  seededRandom,
  type Action,
  type MatchState,
  type Player,
} from './model';
import { BALL_ACTIONS, FIRST_PASS, FIRST_SHOT, FREE_THROW, teammates } from './ball-play';
import { PADDLE_ACTIONS, STROKE_TICKS } from './paddle';

export const INPUTS = 65;
const VALUE_ROW = PADDLE_ACTIONS + BALL_ACTIONS;
export const WEIGHT_COUNT = (VALUE_ROW + 1) * INPUTS;
export const POLICY_VERSION = 'linear-actor-critic-v2';

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
  const relative = (x: number, y: number): number => {
    const angle = Math.atan2(y - player.y, x - player.x) - player.heading;
    return Math.sin(angle);
  };
  const squad = teammates(state, player);
  const opponents = state.players.filter((p) => p.team !== player.team);
  input.push(
    player.yawRate / 3.5,
    player.strokeTicks / STROKE_TICKS,
    relative(ball.x, ball.y),
    relative(direction === 1 ? PITCH.length : 0, PITCH.width / 2),
    Number(ball.lastTouch === player.id),
    ...squad.map((p) => Math.min(1, Math.min(...opponents.map((o) => distance(p, o))) / 6)),
  );
  // Teammates first, then opponents, in stable roster order.
  const others = [...squad, ...opponents];
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
  const paddles =
    player.strokeTicks > 0
      ? []
      : probabilities(weights, observation, 0, PADDLE_ACTIONS, () => true);
  const hasBall = state.ball.owner === player.id;
  const squad = hasBall ? teammates(state, player) : [];
  const shotRange = Math.hypot(
    (attackDirection(player.team, state.half) === 1 ? PITCH.length : 0) - player.x,
    PITCH.width / 2 - player.y,
  );
  const balls = probabilities(weights, observation, PADDLE_ACTIONS, BALL_ACTIONS, (i) => {
    if (i === 0) return true;
    if (!hasBall) return i === 1;
    if (i < FIRST_PASS) return false;
    if (i < FIRST_SHOT) return distance(player, squad[i - FIRST_PASS]) <= 10;
    return i === FREE_THROW || (shotRange <= 12 && state.ball.restrictedThrower === null);
  });
  return {
    observation,
    paddles,
    balls,
    action: { paddle: paddles.length ? choose(paddles, random) : 0, ball: choose(balls, random) },
    value: dot(weights, observation, VALUE_ROW),
  };
}

export function estimateValue(weights: readonly number[], state: MatchState, p: Player): number {
  return dot(weights, observe(state, p), VALUE_ROW);
}

export function addGradient(gradient: Float64Array, decision: PolicySample, target: number): void {
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
