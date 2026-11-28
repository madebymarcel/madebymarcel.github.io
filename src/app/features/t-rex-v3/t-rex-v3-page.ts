import { Component, computed, signal } from '@angular/core';
import { AXES, BONES, ZERO, clampAngles, poseRig, projectRig, viewBox } from './rig';
import type { Angles, Axis, View } from './rig';

@Component({
  templateUrl: './t-rex-v3-page.html',
  styleUrl: './t-rex-v3-page.css',
})
export class TRexV3Page {
  protected readonly bones = BONES.filter((bone) => bone.id !== 'root');
  protected readonly axes = AXES;
  protected readonly views: readonly View[] = ['side', 'top'];
  protected readonly selectedId = signal('pelvis');
  protected readonly angles = signal<Readonly<Record<string, Angles>>>({});
  protected readonly selected = computed(
    () => this.bones.find((bone) => bone.id === this.selectedId()) ?? this.bones[0],
  );
  protected readonly rotation = computed(() => this.angles()[this.selected().id] ?? ZERO);
  protected readonly projections = computed(() => {
    const pose = poseRig(this.angles());
    const side = projectRig(pose, 'side');
    const top = projectRig(pose, 'top');
    return {
      side: { shapes: side, box: viewBox(side, 'side') },
      top: { shapes: top, box: viewBox(top, 'top') },
    };
  });

  protected select(id: string): void {
    if (this.bones.some((bone) => bone.id === id)) {
      this.selectedId.set(id);
    }
  }

  protected setAngle(axis: Axis, raw: string): void {
    const bone = this.selected();
    const rotation = clampAngles(bone, { ...this.rotation(), [axis]: Number(raw) });
    this.angles.update((angles) => ({ ...angles, [bone.id]: rotation }));
  }

  protected resetJoint(): void {
    const id = this.selected().id;
    this.angles.update((angles) => ({ ...angles, [id]: ZERO }));
  }

  protected resetPose(): void {
    this.angles.set({});
  }
}
