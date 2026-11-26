import { PITCH, clamp, distance, seededRandom, type MatchState, type Team } from './model';
import { CanoeMatch, type BallPlay } from './simulation';
import { reachableBall } from './player-body';
import { DEFAULT_REWARDS, type TrainingRewards } from './training-rewards';
import { type Generation } from './generations';
import { addGradient, estimateValue, sample, WEIGHT_COUNT, type PolicySample } from './policy';

const BATCH_STEPS = 96;
export const DISCOUNT = 0.99;
export const LEARNING_RATE = 0.035;

export function ballControlReward(
  play: BallPlay | null,
  id: number,
  rewards: Readonly<TrainingRewards> = DEFAULT_REWARDS,
): number {
  if (!play) return 0;
  if (play.receiver === id && (play.kind === 'claim' || play.kind === 'interception'))
    return rewards.winBall + (play.save ? rewards.saveGoal : 0);
  if (play.kind !== 'pass' || (!play.progressive && !play.escapesPressure)) return 0;
  if (play.from === id) return rewards.usefulPass;
  return play.receiver === id ? rewards.receivePass : 0;
}

interface Transition {
  sample: PolicySample;
  reward: number;
}

export interface TrainingProgress {
  phase: 'training' | 'evaluation';
  ticks: number;
  steps: number;
}

export class GenerationTrainer {
  readonly weights: number[];
  readonly learner: Team;
  private readonly random: () => number;
  private match: CanoeMatch;
  private evaluation = false;
  private trainingSteps = 0;

  constructor(
    private readonly parent: Generation,
    private readonly seed: number,
    private readonly rewards: Readonly<TrainingRewards> = DEFAULT_REWARDS,
    private readonly goalAssist = false,
  ) {
    this.weights = [...parent.weights];
    this.random = seededRandom(seed);
    this.learner = parent.number % 2 === 0 ? 0 : 1;
    this.match = new CanoeMatch(seed);
  }

  get progress(): TrainingProgress {
    return {
      phase: this.evaluation ? 'evaluation' : 'training',
      ticks: this.match.state.ticks,
      steps: this.parent.steps + this.trainingSteps,
    };
  }

  private rewardPotential(state: MatchState, id: number): number {
    const p = state.players[id];
    if (state.ball.owner === id) {
      return (
        this.rewards.advanceWithBall *
        (1 - Math.abs(this.match.attackingGoal(p.team) - p.x) / PITCH.length)
      );
    }
    if (state.ball.owner !== null) return 0;
    return -this.rewards.approachLooseBall * (distance(p, state.ball) / PITCH.length);
  }

  runBatch(limit = BATCH_STEPS): Generation | null {
    const s = this.match.state;
    const trajectories: Transition[][] = Array.from({ length: 5 }, () => []);
    const indices = s.players.filter((p) => p.team === this.learner).map((p) => p.id);

    for (let tick = 0; tick < limit && s.phase !== 'finished'; tick++) {
      if (s.phase !== 'play') {
        this.match.step(s.players.map(() => ({ paddle: 0, ball: 0 })));
        continue;
      }

      const decisions = s.players.map((p) =>
        sample(
          p.team === this.learner ? this.weights : this.parent.weights,
          s,
          p,
          this.random,
          this.goalAssist,
        ),
      );
      const before = indices.map((id) => this.rewardPotential(s, id));
      const nearest =
        s.ball.owner === null
          ? indices.reduce((a, b) =>
              distance(s.players[a], s.ball) <= distance(s.players[b], s.ball) ? a : b,
            )
          : s.ball.owner;
      const chase = s.ball.owner === null;
      const lastTouch = s.ball.lastTouch;
      const ignore =
        chase &&
        s.looseTicks >= 10 &&
        s.players.reduce((a, b) => (distance(a, s.ball) <= distance(b, s.ball) ? a : b)).id ===
          nearest &&
        reachableBall(s.players[nearest], s.ball) &&
        decisions[nearest].action.ball !== 1;
      const event = this.match.step(decisions.map((d) => d.action));

      if (this.evaluation) continue;
      const after: MatchState = this.match.state;
      this.trainingSteps++;
      const goal = event?.kind === 'goal';
      const foul = event?.kind === 'foul';
      let teamReward = 0;
      if (goal)
        teamReward +=
          event.team === this.learner ? this.rewards.scoreGoal : -this.rewards.concedeGoal;
      if (foul)
        teamReward +=
          event.team === this.learner ? -this.rewards.teamFoul : this.rewards.opponentFoul;
      if (after.phase === 'finished') {
        const difference = s.score[this.learner] - s.score[this.learner === 0 ? 1 : 0];
        teamReward += Math.sign(difference) * this.rewards.matchResult;
      }

      indices.forEach((id, i) => {
        let reward = teamReward;
        if (event?.kind === 'out' && lastTouch === id && event.rule !== 'Scoring a goal') {
          reward -= this.rewards.throwOut;
        }
        if (after.phase === 'play' && !event) {
          // Avoid giving five boats the same incentive to crowd the loose ball.
          if (id === nearest && (chase ? s.ball.owner === null : s.ball.owner === id)) {
            reward += this.rewardPotential(s, id) - before[i];
          }
          reward += ballControlReward(this.match.lastBallPlay, id, this.rewards);
          if (ignore && id === nearest && s.ball.owner === null && s.looseTicks % 5 === 0) {
            reward -= this.rewards.ignoreLooseBall;
          }
        }
        trajectories[i].push({ sample: decisions[id], reward });
      });
    }

    if (!this.evaluation) {
      const gradient = new Float64Array(WEIGHT_COUNT);
      let count = 0;
      trajectories.forEach((trajectory, i) => {
        let target =
          s.phase === 'finished' ? 0 : estimateValue(this.weights, s, s.players[indices[i]]);
        for (let j = trajectory.length - 1; j >= 0; j--) {
          const transition = trajectory[j];
          target = transition.reward + DISCOUNT * target;
          addGradient(gradient, transition.sample, target);
          count++;
        }
      });
      if (count > 0) {
        for (let i = 0; i < this.weights.length; i++) {
          const update = LEARNING_RATE * clamp(gradient[i] / count, -1, 1);
          this.weights[i] = clamp(this.weights[i] + update, -10, 10);
        }
      }
    }

    if (s.phase !== 'finished') return null;
    if (!this.evaluation) {
      this.evaluation = true;
      this.match = new CanoeMatch(this.seed + 1);
      return null;
    }

    return {
      id: crypto.randomUUID(),
      parentId: this.parent.id,
      number: this.parent.number + 1,
      weights: [...this.weights],
      matches: this.parent.matches + 1,
      steps: this.parent.steps + this.trainingSteps,
      rewards: { ...this.rewards },
      evaluation: [s.score[this.learner], s.score[this.learner === 0 ? 1 : 0]],
    };
  }
}
