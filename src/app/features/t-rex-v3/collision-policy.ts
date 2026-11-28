import type { Bone } from './rig';

// Only shared joints and deliberately overlapping proximal proxies.
// Never derive exemptions from an arbitrary initial bounding-box overlap.
export function collisionExcluded(a: Bone, b: Bone): boolean {
  if (a.parent === b.id || b.parent === a.id) return true;
  const pair = [a.id, b.id];
  for (const side of ['left-', 'right-']) {
    // Three toes share the same proximal joint region.
    if (pair.every((id) => id.startsWith(side) && id.endsWith('-toe'))) return true;
    // Hip socket joins pelvis and the first rib-cage segment.
    if (pair.includes('spine-1') && pair.includes(side + 'thigh')) return true;
    // Shoulder root overlaps the neighbouring rib-cage segment.
    if (pair.includes('spine-3') && pair.includes(side + 'upper-arm')) return true;
  }
  return false;
}
