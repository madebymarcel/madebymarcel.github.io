import { DistanceTrainer } from './distance-training';
import type { Checkpoint, TrainingFrame } from './distance-training';

export type TrainingRequest =
  | { type: 'start'; seed: number; horizon: number }
  | { type: 'advance'; count: number }
  | { type: 'replay' }
  | { type: 'train' }
  | { type: 'export' }
  | { type: 'import'; checkpoint: unknown };

export type TrainingResponse =
  | { type: 'frame'; frame: TrainingFrame }
  | { type: 'checkpoint'; checkpoint: Checkpoint }
  | { type: 'error'; message: string };

let trainer: DistanceTrainer | undefined;

function send(response: TrainingResponse): void {
  postMessage(response);
}

addEventListener('message', ({ data }: MessageEvent<TrainingRequest>) => {
  try {
    if (data.type === 'start') {
      trainer = new DistanceTrainer(data.seed, data.horizon);
    } else if (data.type === 'import') {
      trainer = DistanceTrainer.restore(data.checkpoint);
    }
    if (!trainer) throw new Error('Start or load training first');
    switch (data.type) {
      case 'advance':
        send({ type: 'frame', frame: trainer.advance(data.count) });
        break;
      case 'replay':
        send({ type: 'frame', frame: trainer.startReplay() });
        break;
      case 'train':
        send({ type: 'frame', frame: trainer.resumeTraining() });
        break;
      case 'export':
        send({ type: 'checkpoint', checkpoint: trainer.checkpoint() });
        break;
      default:
        send({ type: 'frame', frame: trainer.frame() });
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
