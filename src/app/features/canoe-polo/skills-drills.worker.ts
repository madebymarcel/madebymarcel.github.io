import { evaluateDrills } from './skills-drills';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<number[]>) => void;
  postMessage: (message: ReturnType<typeof evaluateDrills>) => void;
};
scope.onmessage = ({ data }) => scope.postMessage(evaluateDrills(data));
