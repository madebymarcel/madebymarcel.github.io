import { type Generation } from './generations';
import { GenerationTrainer, type TrainingProgress } from './training';

interface StartTraining {
  kind: 'start';
  parent: Generation;
  seed: number;
  delay: number;
}

type Command = StartTraining | { kind: 'pause' } | { kind: 'resume' } | { kind: 'pace'; delay: number };
export type TrainingMessage =
  | { kind: 'progress'; progress: TrainingProgress }
  | { kind: 'generation'; generation: Generation };

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<Command>) => void;
  postMessage: (message: TrainingMessage) => void;
};

let trainer: GenerationTrainer | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let delay = 30;
let running = false;

function stop(): void {
  running = false;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function run(): void {
  if (!running || !trainer) return;
  const generation = trainer.runBatch();
  if (generation) {
    stop();
    scope.postMessage({ kind: 'generation', generation });
    return;
  }
  scope.postMessage({ kind: 'progress', progress: trainer.progress });
  timer = setTimeout(run, delay);
}

scope.onmessage = ({ data }) => {
  if (data.kind === 'start') {
    stop();
    trainer = new GenerationTrainer(data.parent, data.seed);
    delay = data.delay;
    running = true;
    run();
  } else if (data.kind === 'pause') {
    stop();
  } else if (data.kind === 'resume' && !running && trainer) {
    running = true;
    run();
  } else if (data.kind === 'pace') {
    delay = data.delay;
  }
};
