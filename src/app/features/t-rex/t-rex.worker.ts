import { trainer } from './spatial-learning.mjs';
const iterate = trainer(536);
let running = false;
function train() {
  if (!running) return;
  postMessage(iterate());
  setTimeout(train, 0);
}
onmessage = ({ data }) => {
  if (data === 'pause') running = false;
  if (data === 'start' && !running) {
    running = true;
    train();
  }
};
