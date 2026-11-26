import { better, type Checkpoint } from '../biped/training';
import { rexTrainer } from './t-rex-walker';

export type RexTrainingUpdate = { iteration: number; best?: Checkpoint };

const trainer = rexTrainer();
let best: Checkpoint | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function advance() {
  if (!running) return;
  trainer.train();
  if (trainer.iteration % 5 === 0) publish();
  timer = setTimeout(advance, 0);
}

function publish() {
  const latest = trainer.checkpoint();
  if (latest.iteration && better(latest, best, 'walk')) best = latest;
  const update: RexTrainingUpdate = { iteration: latest.iteration, best };
  postMessage(update);
}

addEventListener('message', ({ data }: MessageEvent<'start' | 'pause'>) => {
  if (data === 'start' && !running) {
    running = true;
    timer = setTimeout(advance, 0);
  } else if (data === 'pause' && running) {
    running = false;
    clearTimeout(timer);
    publish();
  }
});
