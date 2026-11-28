import { describe, expect, it } from 'vitest';
import { BONES, ZERO, clampAngles, poseRig, projectRig } from './rig';

describe('T. rex V3 rig', () => {
  it('has exactly 40 unique bones and parents precede their children', () => {
    const seen = new Set<string>();
    for (const bone of BONES) {
      expect(seen.has(bone.id)).toBe(false);
      if (bone.parent !== null) {
        expect(seen.has(bone.parent)).toBe(true);
      }
      seen.add(bone.id);
    }
    expect(seen.size).toBe(40);
  });

  it('retains all neutral anchors and endpoints', () => {
    for (const pose of poseRig({})) {
      for (let axis = 0; axis < 3; axis++) {
        expect(pose.start[axis]).toBeCloseTo(pose.bone.start[axis]);
        expect(pose.end[axis]).toBeCloseTo(pose.bone.end[axis]);
      }
    }
  });

  it('locks forbidden rotations and clamps enabled rotations', () => {
    const knee = BONES.find((bone) => bone.id === 'left-lower-leg')!;
    expect(clampAngles(knee, { pitch: 999, yaw: 90, roll: -90 })).toEqual({
      pitch: 65,
      yaw: 0,
      roll: 0,
    });
    expect(clampAngles(knee, { pitch: NaN, yaw: 0, roll: 0 })).toEqual(ZERO);
  });

  it('preserves length and shared joints under rotation', () => {
    const pose = poseRig({
      'left-thigh': { pitch: 35, yaw: 10, roll: 15 },
      'left-lower-leg': { pitch: 40, yaw: 0, roll: 0 },
    });
    for (const p of pose) {
      const length = Math.hypot(...p.end.map((value, i) => value - p.start[i]));
      const rest = Math.hypot(...p.bone.end.map((value, i) => value - p.bone.start[i]));
      expect(length).toBeCloseTo(rest);
    }
    const thigh = pose.find((p) => p.bone.id === 'left-thigh')!;
    const knee = pose.find((p) => p.bone.id === 'left-lower-leg')!;
    knee.start.forEach((value, i) => expect(value).toBeCloseTo(thigh.end[i]));
    const right = pose.find((p) => p.bone.id === 'right-foot')!;
    right.start.forEach((value, i) => expect(value).toBeCloseTo(right.bone.start[i]));
  });

  it('projects all visible bones in far-to-near order in both views', () => {
    const pose = poseRig({});
    for (const view of ['side', 'top'] as const) {
      const shapes = projectRig(pose, view);
      expect(shapes).toHaveLength(39);
      expect(shapes.every((shape) => !shape.points.includes('NaN'))).toBe(true);
      expect(shapes.map((shape) => shape.depth)).toEqual(
        shapes.map((shape) => shape.depth).sort((a, b) => a - b),
      );
    }
    const side = projectRig(pose, 'side');
    expect(side.findIndex((shape) => shape.id === 'right-thigh')).toBeLessThan(
      side.findIndex((shape) => shape.id === 'left-thigh'),
    );
    const top = projectRig(pose, 'top');
    expect(top.findIndex((shape) => shape.id === 'jaw')).toBeLessThan(
      top.findIndex((shape) => shape.id === 'head'),
    );
  });
});
