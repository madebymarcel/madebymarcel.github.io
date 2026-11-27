import type { Segment } from './spatial-learning.mjs';

type Point = [number, number];
const pair = (p: Point) => p.map((value) => value.toFixed(2)).join(' ');
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function rounded(points: Point[]) {
  const first = midpoint(points[points.length - 1], points[0]);
  return (
    'M ' +
    pair(first) +
    points
      .map((p, i) => ' Q ' + pair(p) + ' ' + pair(midpoint(p, points[(i + 1) % points.length])))
      .join('') +
    ' Z'
  );
}

export function project(bones: Segment[], side: boolean) {
  const origin = bones[0].start;
  const position = (p: Segment['start']): Point =>
    side
      ? [220 + (p.x - origin.x) * 90, 195 - p.y * 90]
      : [210 + (p.z - origin.z) * 145, 285 - (p.x - origin.x) * 145];
  const layer = (name: string) =>
    name.startsWith('thigh') ? 1 : /shin|metatarsus|toes/.test(name) ? 0 : 2;
  const segments = [...bones]
    .sort((a, b) => layer(a.name) - layer(b.name))
    .map((b) => {
      const start = position(b.start);
      const end = position(b.end);
      const points = b.outline.map(position);
      return {
        name: b.name,
        eyes: b.eyes.map(position),
        outline: 'M ' + points.map(pair).join(' L ') + ' Z',
        skin: b.name.startsWith('toes')
          ? 'M ' + points.map(pair).join(' L ') + ' Z'
          : rounded(points),
        d: 'M ' + pair(start) + ' L ' + pair(end),
        width: side ? b.depth * 90 : b.width * 145,
        fill: ['#526b46', '#77965c', '#76965e'][layer(b.name)],
      };
    });
  const tail = bones.filter((b) => b.name.startsWith('tail-'));
  const centers = [position(tail[0].start), ...tail.map((b) => position(b.end))];
  const edges = (sign: number) =>
    centers.map((center, i): Point => {
      const before = centers[Math.max(0, i - 1)];
      const after = centers[Math.min(centers.length - 1, i + 1)];
      const dx = after[0] - before[0];
      const dy = after[1] - before[1];
      const length = Math.hypot(dx, dy) || 1;
      const width =
        i === centers.length - 1 ? 1.6 : side ? tail[i].depth * 45 : tail[i].width * 72.5;
      return [center[0] - (sign * dy * width) / length, center[1] + (sign * dx * width) / length];
    });
  return {
    segments,
    tail: rounded([...edges(1), ...edges(-1).reverse()]),
  };
}
