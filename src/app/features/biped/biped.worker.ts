import { better, DEFAULT_SEED, Trainer, type Checkpoint } from './training';
import { SKILLS, type Skill } from './tasks';

export const BATCH_ITERATIONS = 100;
export type TrainingMessage =
  | { type: 'start'; skill: Skill }
  | { type: 'all' }
  | { type: 'pause' }
  | { type: 'reset'; skill: Skill; seed: number };
export type TrainingUpdate = {
  skill: Skill;
  seed: number;
  sessions: number;
  latest: Checkpoint;
  best?: Checkpoint;
  baseline: Checkpoint;
};
type Status = { active: Skill | null };
type Job = {
  trainer: Trainer;
  seed: number;
  sessions: number;
  baseline: Checkpoint;
  best?: Checkpoint;
};
const jobs = new Map<Skill, Job>();
let active: Skill | null = null;
let batch: Skill[] = [];
let until = Infinity;
let startedAt = 0;
let scheduled: ReturnType<typeof setTimeout> | undefined;

function jobFor(skill: Skill, seed = DEFAULT_SEED): Job {
  const cached = jobs.get(skill);
  if (cached) return cached;
  const trainer = new Trainer(seed, skill, jobs.get('walk')?.best?.policy);
  const job = { trainer, seed, sessions: 0, baseline: trainer.checkpoint() };
  jobs.set(skill, job);
  return job;
}

function publish(skill: Skill, job: Job, latest: Checkpoint) {
  const update: TrainingUpdate = {
    skill,
    seed: job.seed,
    sessions: job.sessions,
    latest,
    best: job.best,
    baseline: job.baseline,
  };
  postMessage(update);
}

function recordBest(skill: Skill, job: Job) {
  const latest = job.trainer.checkpoint();
  if (latest.iteration && better(latest, job.best, skill)) job.best = latest;
  return latest;
}

function status() {
  const message: Status = { active };
  postMessage(message);
}

function advance() {
  if (!active) return;
  const job = jobFor(active);
  job.trainer.train();
  if (job.trainer.iteration % 5 === 0 || job.trainer.iteration >= until) {
    const latest = recordBest(active, job);
    const complete =
      Number.isFinite(until) && (job.trainer.iteration >= until || mastered(active, job));
    if (complete) job.sessions++;
    publish(active, job, latest);
    if (complete) {
      startNext();
      return;
    }
  }
  scheduled = setTimeout(advance, 0);
}

function mastered(skill: Skill, job: Job | undefined) {
  return skill !== 'run' && job?.best?.evaluation.passes === 5;
}

function startNext() {
  active = batch.shift() ?? null;
  while (active && mastered(active, jobs.get(active))) active = batch.shift() ?? null;
  status();
  if (active) {
    startedAt = jobFor(active).trainer.iteration;
    until = startedAt + BATCH_ITERATIONS;
    scheduled = setTimeout(advance, 0);
  }
}

function pause() {
  clearTimeout(scheduled);
  if (active) {
    const job = jobFor(active);
    if (job.trainer.iteration > startedAt) job.sessions++;
    publish(active, job, recordBest(active, job));
  }
  active = null;
  batch = [];
  status();
}

addEventListener('message', ({ data }: MessageEvent<TrainingMessage>) => {
  if (data.type === 'start' && !active) {
    active = data.skill;
    until = Infinity;
    startedAt = jobFor(active).trainer.iteration;
    status();
    scheduled = setTimeout(advance, 0);
  } else if (data.type === 'all' && !active) {
    batch = [...SKILLS];
    startNext();
  } else if (data.type === 'pause') {
    pause();
  } else if (data.type === 'reset') {
    if (active) pause();
    jobs.delete(data.skill);
    const job = jobFor(data.skill, data.seed);
    publish(data.skill, job, job.baseline);
  }
});

const walk = jobFor('walk');
publish('walk', walk, walk.baseline);
