import { Component, computed, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { PassiveRig, STEP } from './passive-physics';
import type { PhysicsSnapshot } from './passive-physics';
import { AXES, BONES, ZERO, clampAngles, poseRig, projectRig, viewBox } from './rig';
import type { Angles, Axis, View } from './rig';
import { signedUnit } from './neuromuscular';
import type { Commands, ControlMode } from './neuromuscular';

@Component({
  templateUrl: './t-rex-v3-page.html',
  styleUrl: './t-rex-v3-page.css',
})
export class TRexV3Page implements OnDestroy {
  private simulation: PassiveRig | null = null;
  private request: number | null = null;
  private lastFrame: number | null = null;
  private accumulator = 0;
  protected readonly running = signal(false);
  protected readonly ligaments = signal(false);
  protected readonly mode = signal<ControlMode>('off');
  protected readonly commands = signal<Commands>({});
  private readonly control = computed(() => ({
    ligaments: this.ligaments(),
    mode: this.mode(),
    commands: this.commands(),
  }));
  protected readonly snapshot = signal<PhysicsSnapshot | null>(null);
  protected readonly bones = BONES.filter((bone) => bone.id !== 'root');
  protected readonly axes = AXES;
  protected readonly views: readonly View[] = ['side', 'top'];
  protected readonly selectedId = signal('pelvis');
  protected readonly angles = signal<Readonly<Record<string, Angles>>>({});
  protected readonly selected = computed(
    () => this.bones.find((bone) => bone.id === this.selectedId()) ?? this.bones[0],
  );
  protected readonly rotation = computed(() => this.angles()[this.selected().id] ?? ZERO);
  protected readonly selectedSense = computed(() =>
    this.snapshot()?.sensors.joints.find((joint) => joint.id === this.selectedId()),
  );
  protected readonly selectedContact = computed(
    () => this.snapshot()?.sensors.contacts[this.selectedId()],
  );

  protected setMode(value: string): void {
    if (value === 'off' || value === 'manual' || value === 'reflex') {
      this.mode.set(value);
    }
  }

  protected setMuscle(axis: Axis, raw: string): void {
    const id = this.selectedId();
    const joint = this.selectedSense();
    if (!joint || joint.axes[axis].locked || this.mode() !== 'manual') return;
    this.commands.update((commands) => ({
      ...commands,
      [id]: { ...commands[id], [axis]: signedUnit(Number(raw)) },
    }));
  }

  protected clearMuscles(): void {
    this.commands.set({});
  }

  protected vectorText(value: readonly number[]): string {
    return value.map((component) => component.toFixed(2)).join(', ');
  }

  protected degrees(value: number): string {
    return ((value * 180) / Math.PI).toFixed(1);
  }
  protected readonly projections = computed(() => {
    const state = this.snapshot();
    const pose = state?.valid ? state.pose : poseRig(this.angles());
    const side = projectRig(pose, 'side');
    const top = projectRig(pose, 'top');
    return {
      side: { shapes: side, box: viewBox(side, 'side') },
      top: { shapes: top, box: viewBox(top, 'top') },
    };
  });

  protected release(): void {
    this.startExperiment(0.35, 5);
  }

  protected stance(): void {
    this.startExperiment(0.02, 0);
  }

  protected airborne(): void {
    this.startExperiment(2, 0);
  }

  private startExperiment(height: number, tilt: number): void {
    this.pause();
    this.clearMuscles();
    this.simulation = new PassiveRig(height, tilt);
    this.snapshot.set(this.simulation.snapshot());
    this.resume();
  }

  protected pause(): void {
    this.running.set(false);
    if (this.request !== null) cancelAnimationFrame(this.request);
    this.request = null;
    this.lastFrame = null;
    this.accumulator = 0;
  }

  protected resume(): void {
    if (!this.simulation || this.running() || !this.snapshot()?.valid) return;
    this.running.set(true);
    this.request = requestAnimationFrame(this.tick);
  }

  protected singleStep(): void {
    if (!this.simulation || this.running() || !this.snapshot()?.valid) return;
    this.simulation.step(this.control());
    this.snapshot.set(this.simulation.snapshot());
  }

  protected returnToRig(): void {
    this.pause();
    this.simulation = null;
    this.snapshot.set(null);
  }

  ngOnDestroy(): void {
    this.pause();
  }

  private readonly tick = (now: number): void => {
    if (!this.running() || !this.simulation) return;
    if (this.lastFrame !== null) {
      this.accumulator += Math.min((now - this.lastFrame) / 1000, 0.05);
    }
    this.lastFrame = now;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 6) {
      this.simulation.step(this.control());
      this.accumulator -= STEP;
      steps++;
    }
    if (steps > 0) {
      const state = this.simulation.snapshot();
      this.snapshot.set(state);
      if (!state.valid) {
        this.pause();
        return;
      }
    }
    this.request = requestAnimationFrame(this.tick);
  };

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
