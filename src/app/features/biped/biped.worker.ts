import { DEFAULT_SEED, Trainer, type Checkpoint } from './training';

export type TrainingMessage =
  { type: 'start' } | { type: 'pause' } | { type: 'reset'; epoch: number; seed: number };
export type TrainingUpdate = { epoch: number; checkpoint: Checkpoint };
let epoch = 0;
let trainer = new Trainer(DEFAULT_SEED);
let scheduled: ReturnType<typeof setTimeout> | undefined;
let running = false;

function publish() {
  const update: TrainingUpdate = { epoch, checkpoint: trainer.checkpoint() };
  postMessage(update);
}

function advance() {
  trainer.train();
  if (trainer.iteration % 5 === 0) publish();
  scheduled = setTimeout(advance, 0);
}

function pause() {
  running = false;
  clearTimeout(scheduled);
}

addEventListener('message', ({ data }: MessageEvent<TrainingMessage>) => {
  if (data.type === 'start' && !running) {
    running = true;
    scheduled = setTimeout(advance, 0);
  } else if (data.type === 'pause') {
    pause();
    publish();
  } else if (data.type === 'reset') {
    pause();
    epoch = data.epoch;
    trainer = new Trainer(data.seed);
    publish();
  }
});
