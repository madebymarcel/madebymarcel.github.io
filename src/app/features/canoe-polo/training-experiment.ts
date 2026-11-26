import { FREE_THROW } from './ball-play';
import { GENESIS, type Generation } from './generations';
import { BALL_RADIUS, PITCH, POSSESSION_TICKS, clamp, seededRandom, type Action } from './model';
import {
  addGradient,
  initialWeights,
  sample,
  SHOT_AIM,
  SHOT_LOFT,
  SHOT_POWER,
  WEIGHT_COUNT,
  type PolicySample,
} from './policy';
import { CanoeMatch } from './simulation';
import { DISCOUNT, GenerationTrainer, LEARNING_RATE } from './training';
import { DEFAULT_REWARDS, REWARD_KEYS, type TrainingRewards } from './training-rewards';

const IDLE: Action = { paddle: 0, ball: 0 };
const IDLE_TEAMS = Array.from({ length: 10 }, () => IDLE);
const SHOT_LIMIT = POSSESSION_TICKS + 30;
const UPDATE_EVERY = 96;
const SEEDS = [20261126, 4271, 81799];
const EVAL_SEED = 825551;
const SCORE_ONLY = Object.fromEntries(REWARD_KEYS.map((key) => [key, 0])) as TrainingRewards;
SCORE_ONLY.scoreGoal = DEFAULT_REWARDS.scoreGoal;
SCORE_ONLY.throwOut = DEFAULT_REWARDS.throwOut;

type Random = () => number;
type Band = 'near' | 'transfer';
interface Pose {
  distance: number;
  lateral: number;
  angle: number;
  moving: boolean;
  seed: number;
}

function makePose(random: Random, band: Band): Pose {
  return {
    distance: band === 'near' ? 2 + 2 * random() : 4 + 4 * random(),
    lateral: (random() - 0.5) * 4,
    angle: (random() - 0.5) * (band === 'near' ? 0.4 : 1.4),
    moving: band === 'transfer' && random() < 0.5,
    seed: Math.floor(random() * 2 ** 32),
  };
}

function shotState(pose: Pose): CanoeMatch {
  const match = new CanoeMatch(pose.seed);
  const s = match.state;
  for (const p of s.players) {
    p.x = 2 + 2 * (p.id % 2);
    p.y = 2 + 4 * Math.floor(p.id / 2);
  }
  const player = s.players[0];
  Object.assign(player, {
    x: PITCH.length + BALL_RADIUS - pose.distance,
    y: PITCH.width / 2 + pose.lateral,
    heading: Math.atan2(-pose.lateral, pose.distance) + pose.angle,
    vx: pose.moving ? -1.2 : 0,
    vy: pose.moving ? 0.8 : 0,
    yawRate: pose.moving ? 0.7 : 0,
  });
  Object.assign(s.ball, { x: player.x, y: player.y, z: 1.1, owner: 0, lastTouch: 0 });
  s.possessionTeam = 0;
  match.refreshVision();
  return match;
}

interface Attempt {
  ticks: number;
  goal: boolean;
  out: boolean;
  threw: boolean;
  choices: { time: number; decision: PolicySample }[];
}

function shoot(
  pose: Pose,
  choose: (match: CanoeMatch) => PolicySample | Action,
  limit = SHOT_LIMIT,
): Attempt {
  const match = shotState(pose);
  const s = match.state;
  const choices: Attempt['choices'] = [];
  let threw = false;
  let ticks = 0;
  let out = false;
  for (; ticks < limit && s.phase === 'play';) {
    let action = IDLE;
    if (s.ball.owner === 0) {
      const selected = choose(match);
      if ('action' in selected) {
        choices.push({ time: ticks, decision: selected });
        action = selected.action;
      } else {
        action = selected;
      }
    }
    const event = match.step(action === IDLE ? IDLE_TEAMS : [action, ...IDLE_TEAMS.slice(1)]);
    ticks++;
    threw ||= action.ball === FREE_THROW && s.ball.owner === null;
    out ||= event?.kind === 'out';
    if (s.ball.owner === null && s.ball.z === BALL_RADIUS && threw) break;
  }
  return { ticks, goal: s.score[0] > 0, out, threw, choices };
}

export function probeShootingPose(pose: Pose): number {
  let viable = 0;
  for (const hand of [-1, 1] as const) {
    for (const aim of SHOT_AIM) {
      for (const power of SHOT_POWER) {
        for (const loft of SHOT_LOFT) {
          if (shoot(pose, () => ({ paddle: 0, ball: FREE_THROW, hand, aim, power, loft })).goal) {
            viable++;
          }
        }
      }
    }
  }
  return viable;
}

function trainPractice(start: number[], seed: number, budget: number, widen: boolean): number[] {
  const weights = [...start];
  const poses = seededRandom(seed ^ 0xdeadbeef);
  const policy = seededRandom(seed);
  let spent = 0;
  let batch = 0;
  let observations = 0;
  let gradient = new Float64Array(WEIGHT_COUNT);
  while (spent < budget) {
    const band = widen && spent >= budget / 2 && poses() < 2 / 3 ? 'transfer' : 'near';
    const attempt = shoot(
      makePose(poses, band),
      (m) => sample(weights, m.state, m.state.players[0], policy),
      Math.min(SHOT_LIMIT, budget - spent),
    );
    spent += attempt.ticks;
    batch += attempt.ticks;
    const reward = attempt.goal ? SCORE_ONLY.scoreGoal : attempt.out ? -SCORE_ONLY.throwOut : 0;
    for (const { time, decision } of attempt.choices) {
      addGradient(gradient, decision, reward * DISCOUNT ** (attempt.ticks - time - 1));
      observations++;
    }
    if (batch >= UPDATE_EVERY || spent >= budget) {
      for (let i = 0; i < weights.length; i++) {
        weights[i] = clamp(
          weights[i] + LEARNING_RATE * clamp(gradient[i] / Math.max(1, observations), -1, 1),
          -10,
          10,
        );
      }
      batch = 0;
      observations = 0;
      gradient = new Float64Array(WEIGHT_COUNT);
    }
  }
  return weights;
}

function trainMatches(
  weights: number[],
  seed: number,
  budget: number,
  rewards: TrainingRewards,
): number[] {
  let parent: Generation = { ...GENESIS, weights };
  let trainer = new GenerationTrainer(parent, seed, rewards);
  while (trainer.progress.steps < budget) {
    const next = trainer.runBatch(Math.min(UPDATE_EVERY, budget - trainer.progress.steps));
    if (next) {
      parent = { ...next, id: `training-${next.number}` };
      trainer = new GenerationTrainer(parent, seed + parent.number * 17, rewards);
    }
  }
  return [...trainer.weights];
}

function evaluationPoses(band: Band, count = 64): Pose[] {
  const starts = seededRandom(EVAL_SEED ^ (band === 'near' ? 31 : 71));
  return Array.from({ length: count }, () => makePose(starts, band));
}

function evalShots(weights: readonly number[], band: Band) {
  const poses = evaluationPoses(band);
  let goals = 0;
  let throws = 0;
  for (const pose of poses) {
    const random = seededRandom(pose.seed ^ 0xf00d);
    const a = shoot(pose, (m) => sample(weights, m.state, m.state.players[0], random));
    goals += Number(a.goal);
    throws += Number(a.threw);
  }
  return { trials: poses.length, goals, throws };
}

function evalMatches(candidate: readonly number[], baseline: readonly number[]) {
  let goals = 0;
  let conceded = 0;
  let heldTicks = 0;
  let possessions = 0;
  let completedPasses = 0;
  let throws = 0;
  const count = 4;
  for (let game = 0; game < count; game++) {
    const seed = EVAL_SEED + Math.floor(game / 2) * 101;
    const team = game % 2;
    const rng = seededRandom(seed);
    const m = new CanoeMatch(seed);
    const s = m.state;
    let lastOwner: number | null = null;
    while (s.phase !== 'finished') {
      const owner = s.ball.owner;
      const ours = owner !== null && s.players[owner].team === team;
      if (ours) {
        heldTicks++;
        if (owner !== lastOwner) possessions++;
      }
      lastOwner = owner;
      const actions =
        s.phase !== 'play'
          ? IDLE_TEAMS
          : s.players.map((p) => sample(p.team === team ? candidate : baseline, s, p, rng).action);
      m.step(actions);
      if (ours && actions[owner].ball === FREE_THROW && s.ball.owner === null) throws++;
      if (m.lastBallPlay?.kind === 'pass' && s.players[m.lastBallPlay.receiver].team === team) {
        completedPasses++;
      }
    }
    goals += s.score[team];
    conceded += s.score[1 - team];
  }
  return { games: count, goals, conceded, heldTicks, possessions, completedPasses, throws };
}

/** Developer-only experiment; not called by the app or the training worker. */
export function runCanoeExperiment(
  budget: number,
  write: (result: Record<string, unknown>) => void,
): void {
  write({
    type: 'reachability',
    poses: [2, 4, 6, 8, 10, 12].flatMap((distance) =>
      [false, true].map((moving) => ({
        distance,
        moving,
        viable: probeShootingPose({ distance, moving, angle: 0, lateral: 0, seed: EVAL_SEED }),
      })),
    ),
    tuples: 2 * SHOT_AIM.length * SHOT_POWER.length * SHOT_LOFT.length,
  });
  write({
    type: 'evaluation-ceiling-at-start',
    bands: (['near', 'transfer'] as const).map((band) => {
      const poses = evaluationPoses(band);
      return {
        band,
        trials: poses.length,
        viable: poses.filter((pose) => probeShootingPose(pose) > 0).length,
      };
    }),
  });
  for (const seed of SEEDS) {
    const start = initialWeights(seed);
    for (const [arm, getWeights] of [
      ['untrained', () => start],
      ['full-default', () => trainMatches(start, seed, budget, DEFAULT_REWARDS)],
      ['full-shot-reward', () => trainMatches(start, seed, budget, SCORE_ONLY)],
      ['short-shot-practice', () => trainPractice(start, seed, budget, false)],
      ['widened-shot-practice', () => trainPractice(start, seed, budget, true)],
    ] as const) {
      const weights = getWeights();
      write({
        type: 'evaluation',
        seed,
        budget: arm === 'untrained' ? 0 : budget,
        arm,
        near: evalShots(weights, 'near'),
        transfer: evalShots(weights, 'transfer'),
        match: evalMatches(weights, start),
      });
    }
  }
}
