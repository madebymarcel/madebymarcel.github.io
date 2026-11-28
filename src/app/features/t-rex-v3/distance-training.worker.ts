import { DistanceTrainer } from './distance-training';
import { DepTrainer } from './dep-training';
import type { DepResult } from './dep-rollout';
import type { RolloutResult } from './rollout-collection';
import type { TrainingFrame } from './distance-training';
import type { Brain, BrainCheckpoint, BrainFrame, BrainJob, BrainResult } from './training-protocol';

export type TrainingRequest =
  | { type: 'start'; brain: Brain; seed: number; horizon: number }
  | { type: 'advance'; count: number; lanes: number }
  | { type: 'finish-round'; results: readonly BrainResult[] }
  | { type: 'cancel-round'; round: number }
  | { type: 'enable-mpo' }
  | { type: 'replay' }
  | { type: 'train' }
  | { type: 'export' }
  | { type: 'import'; checkpoint: unknown };

export type TrainingResponse =
  | { type: 'frame'; frame: BrainFrame }
  | { type: 'collect'; jobs: readonly BrainJob[] }
  | { type: 'checkpoint'; checkpoint: BrainCheckpoint }
  | { type: 'error'; message: string };

let trainer: DistanceTrainer | DepTrainer | undefined;

function send(response: TrainingResponse): void {
  postMessage(response);
}

function sendFrame(frame: TrainingFrame | BrainFrame): void {
  send({ type: 'frame', frame: 'brain' in frame ? frame : { ...frame, brain: 'ppo' } });
}

function isDepResult(result: BrainResult): result is DepResult {
  return 'brain' in result;
}

function isPpoResult(result: BrainResult): result is RolloutResult {
  return !isDepResult(result);
}

addEventListener('message', ({ data }: MessageEvent<TrainingRequest>) => {
  try {
    if (data.type === 'start') {
      trainer = data.brain === 'ppo'
        ? new DistanceTrainer(data.seed, data.horizon)
        : new DepTrainer(data.seed, data.horizon, data.brain);
    } else if (data.type === 'import') {
      const saved = data.checkpoint;
      trainer = typeof saved === 'object' && saved !== null &&
        'format' in saved && saved.format === 'trex-v3-dep-mpo-1'
        ? DepTrainer.restore(saved)
        : DistanceTrainer.restore(saved);
    }
    if (!trainer) throw new Error('Start or load training first');
    switch (data.type) {
      case 'advance':
        if (trainer.frame().phase === 'training') {
          send({ type: 'collect', jobs: trainer.beginRound(data.lanes) });
        } else {
          sendFrame(trainer instanceof DepTrainer
            ? trainer.advance(data.count)
            : trainer.advance(data.count, true));
        }
        break;
      case 'finish-round':
        if (trainer instanceof DepTrainer) {
          if (!data.results.every(isDepResult)) throw new Error('Wrong brain rollout type');
          sendFrame(trainer.finishRound(data.results));
        } else {
          if (!data.results.every(isPpoResult)) throw new Error('Wrong brain rollout type');
          sendFrame(trainer.finishRound(data.results));
        }
        break;
      case 'cancel-round':
        sendFrame(trainer.cancelRound(data.round));
        break;
      case 'enable-mpo':
        if (!(trainer instanceof DepTrainer)) throw new Error('Start pure DEP first');
        sendFrame(trainer.enableMpo());
        break;
      case 'replay':
        sendFrame(trainer.startReplay());
        break;
      case 'train':
        sendFrame(trainer.resumeTraining());
        break;
      case 'export':
        send({ type: 'checkpoint', checkpoint: trainer.checkpoint() });
        break;
      default:
        sendFrame(trainer.frame());
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
