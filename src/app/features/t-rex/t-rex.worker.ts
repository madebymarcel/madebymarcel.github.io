import { assess, type Candidate, type Evaluation } from './servo-search.mjs';

export type EvaluationRequest = { id: number; candidates: Candidate[] };
export type EvaluationResponse = { id: number; evaluations: Evaluation[] };

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<EvaluationRequest>) => void;
  postMessage: (message: EvaluationResponse) => void;
};

scope.onmessage = ({ data }) => {
  scope.postMessage({
    id: data.id,
    evaluations: data.candidates.map((candidate) => assess(candidate.policy)),
  });
};
