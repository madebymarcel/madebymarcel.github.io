import {
  BALL_RADIUS,
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
import { BALL_ACTIONS, FIRST_PASS, FREE_THROW, teammates } from './ball-play';
import { PADDLE_ACTIONS, STROKE_TICKS } from './paddle';

export const INPUTS = 72;
const look = [-1, 0, 1];
export const SHOT_AIM = [-1.3, -0.85, -0.48, -0.24, -0.1, 0, 0.1, 0.24, 0.48, 0.85, 1.3];
export const SHOT_POWER = [0.45, 0.65, 0.82, 1];
export const SHOT_LOFT = [0.24, 0.4, 0.55, 0.72, 0.9];
const sizes = [
  PADDLE_ACTIONS,
  BALL_ACTIONS,
  look.length,
  2,
  SHOT_AIM.length,
  SHOT_POWER.length,
  SHOT_LOFT.length,
];
const offsets = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
const VALUE_ROW = sizes.reduce((a, b) => a + b, 0);
export const WEIGHT_COUNT = (VALUE_ROW + 1) * INPUTS;
export const POLICY_VERSION = 'linear-actor-critic-v3';

export interface PolicySample {
  observation: number[];
  action: Action;
  choices: { probabilities: number[]; picked: number; offset: number }[];
  value: number;
}

export function initialWeights(seed = 42): number[] {
  const random = seededRandom(seed);
  return Array.from({ length: WEIGHT_COUNT }, () => (random() - 0.5) * 0.04);
}

export function observe(state: MatchState, player: Player): number[] {
  const direction = attackDirection(player.team, state.half);
  const ball = player.seenBall;
  const holding = state.ball.owner === player.id;
  const goalOffset =
    Math.atan2(PITCH.width / 2 - player.y, (direction === 1 ? PITCH.length : 0) - player.x) -
    player.heading;
  const squad = teammates(state, player);
  const roster = [...squad, ...state.players.filter((p) => p.team !== player.team)];
  const input = [
    1,
    (direction === 1 ? player.x : PITCH.length - player.x) / PITCH.length,
    (direction === 1 ? player.y : PITCH.width - player.y) / PITCH.width,
    Math.cos(player.heading) * direction,
    Math.sin(player.heading) * direction,
    (player.vx * direction) / 3.5,
    (player.vy * direction) / 3.5,
    player.yawRate / 3.5,
    player.strokeTicks / STROKE_TICKS,
    player.headTurn / 1.25,
    player.dominantHand,
    Math.sin(goalOffset),
    Math.cos(goalOffset),
    Number(holding),
    Number(state.ball.restrictedThrower === player.id),
    holding ? state.possessionTicks / POSSESSION_TICKS : 0,
    state.shotTicks / SHOT_TICKS,
    clamp((state.score[player.team] - state.score[1 - player.team]) / 5, -1, 1),
    1 - state.ticks / (2 * HALF_TICKS),
    ball ? 1 - (state.ticks - ball.tick) / 11 : 0,
    Number(ball?.owner != null && state.players[ball.owner].team === player.team),
    Number(ball?.owner != null && state.players[ball.owner].team !== player.team),
    ball ? ((ball.x - player.x) * direction) / PITCH.length : 0,
    ball ? ((ball.y - player.y) * direction) / PITCH.width : 0,
    ball ? ball.z / 4 : 0,
    ball ? (ball.vx * direction) / 11 : 0,
    ball ? (ball.vy * direction) / 11 : 0,
  ];
  for (const { id } of roster) {
    const seen = player.seenPlayers[id];
    input.push(
      seen ? 1 - (state.ticks - seen.tick) / 11 : 0,
      seen ? ((seen.x - player.x) * direction) / PITCH.length : 0,
      seen ? ((seen.y - player.y) * direction) / PITCH.width : 0,
      seen ? (seen.vx * direction) / 3.5 : 0,
      seen ? (seen.vy * direction) / 3.5 : 0,
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
  for (let i = probability.length - 1; i >= 0; i--) if (probability[i] > 0) return i;
  return 0;
}

export function sample(
  weights: readonly number[],
  state: MatchState,
  player: Player,
  random: () => number,
  goalAssist = false,
): PolicySample {
  const observation = observe(state, player);
  const choices: PolicySample['choices'] = [];
  const draw = (i: number, allowed: (index: number) => boolean = () => true): number => {
    const offset = offsets[i];
    const distribution = probabilities(weights, observation, offset, sizes[i], allowed);
    const picked = choose(distribution, random);
    choices.push({ probabilities: distribution, picked, offset });
    return picked;
  };
  const holding = state.ball.owner === player.id;
  const paddle = holding || player.strokeTicks ? 0 : draw(0);
  const squad = holding ? teammates(state, player) : [];
  const ball = draw(1, (i) => {
    if (i === 0) return true;
    if (!holding) {
      const seen = player.seenBall;
      return (
        i === 1 &&
        !!seen &&
        seen.owner === null &&
        distance(player, seen) < 2.8 &&
        (seen.z === BALL_RADIUS || (!paddle && !player.strokeTicks))
      );
    }
    if (i === 1) return false;
    if (i === FREE_THROW) return true;
    const seen = player.seenPlayers[squad[i - FIRST_PASS].id];
    return !!seen && distance(player, seen) <= 10;
  });
  const action: Action = { paddle, ball, look: look[draw(2)] };
  if (holding && ball >= FIRST_PASS) {
    action.hand = draw(3) === 0 ? player.dominantHand : player.dominantHand === 1 ? -1 : 1;
    if (ball === FREE_THROW) {
      if (goalAssist) {
        action.goalAssist = true;
      } else {
        action.aim = SHOT_AIM[draw(4)];
        action.power = SHOT_POWER[draw(5)];
        action.loft = SHOT_LOFT[draw(6)];
      }
    } else {
      action.passTo = player.seenPlayers[squad[ball - FIRST_PASS].id] ?? undefined;
    }
  }
  return { observation, action, choices, value: dot(weights, observation, VALUE_ROW) };
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
  for (const choice of decision.choices) {
    choice.probabilities.forEach((prob, i) => {
      accumulate(choice.offset + i, advantage * (Number(i === choice.picked) - prob));
    });
  }
  accumulate(VALUE_ROW, 0.5 * advantage);
}
