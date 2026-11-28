import type { CapabilityGate, CapabilityReport } from './capability-audit';
import type { Checkpoint, TrainingFrame } from './distance-training';
import type { DepCheckpoint } from './dep-training';
import type { DepJob, DepResult } from './dep-rollout';
import type { RolloutJob, RolloutResult } from './rollout-collection';

export type Brain = 'ppo' | 'dep' | 'dep-mpo';
export type BrainJob = RolloutJob | DepJob;
export type BrainResult = RolloutResult | DepResult;
export type BrainCheckpoint = Checkpoint | DepCheckpoint;

export interface BrainFrame extends TrainingFrame {
  readonly brain: Brain;
  readonly gate?: CapabilityGate;
  readonly bestCapability?: CapabilityReport;
  readonly replaySize?: number;
  readonly depDecisions?: number;
  readonly warmup?: number;
  readonly latestEvaluationSeconds?: number | null;
  readonly bestEvaluationSeconds?: number | null;
  readonly sampledTransitions?: number;
}
