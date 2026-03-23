import type { RegisterBankName, RegisterType, TimedBehavior } from '../types.ts';
import type { DeviceRuntime } from './device-runtime.ts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const INTEGER_REGISTER_TYPES: Set<RegisterType> = new Set([
  'uint16',
  'int16',
  'uint32',
  'int32'
]);

interface BehaviorState {
  startedAt: number;
  lastRunAt: number | null;
}

interface BehaviorErrorContext {
  device: DeviceRuntime;
  behavior: TimedBehavior;
  index: number;
}

interface BehaviorEngineOptions {
  tickMs?: number;
  random?: () => number;
  onError?: (error: Error, context: BehaviorErrorContext) => void;
}

export class BehaviorEngine {
  devices: DeviceRuntime[];

  tickMs: number;

  random: () => number;

  onError: (error: Error, context: BehaviorErrorContext) => void;

  state: Map<string, BehaviorState>;

  timer: NodeJS.Timeout | null;

  originMs: number | null;

  constructor(devices: DeviceRuntime[], options: BehaviorEngineOptions = {}) {
    this.devices = devices;
    this.tickMs = options.tickMs ?? 500;
    this.random = options.random ?? Math.random;
    this.onError =
      options.onError ??
      ((error: Error, context: BehaviorErrorContext) => {
        console.error(
          `[BehaviorEngine] device=${context.device.id} behavior=${context.behavior.type} address=${context.behavior.address} ${error.message}`
        );
      });
    this.state = new Map<string, BehaviorState>();
    this.timer = null;
    this.originMs = null;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    if (this.originMs == null) {
      this.originMs = Date.now();
    }

    this.timer = setInterval(() => {
      this.tick(Date.now());
    }, this.tickMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  tick(now = Date.now()): void {
    if (this.originMs == null) {
      this.originMs = now;
    }

    for (const device of this.devices) {
      if (!device.shouldRunBehaviors()) {
        continue;
      }

      device.getTimedBehaviors().forEach((behavior, index) => {
        const key = `${device.id}:${index}`;
        const state = this.state.get(key) ?? {
          startedAt: now,
          lastRunAt: null
        };
        const intervalMs = behavior.intervalMs ?? this.tickMs;

        if (state.lastRunAt != null && now - state.lastRunAt < intervalMs) {
          return;
        }

        try {
          this.applyBehavior(device, behavior, state, now);
          state.lastRunAt = now;
          this.state.set(key, state);
        } catch (error) {
          const normalizedError =
            error instanceof Error ? error : new Error(String(error));

          this.onError(normalizedError, {
            device,
            behavior,
            index
          });
        }
      });
    }
  }

  normalizeValueForEntry(
    device: DeviceRuntime,
    bank: RegisterBankName,
    address: number,
    value: number
  ): number {
    const entry = device.getEntry(bank, address);

    if (!entry) {
      throw new Error(`Unknown ${bank} entry at address ${address}`);
    }

    if (INTEGER_REGISTER_TYPES.has(entry.type)) {
      return Math.round(value);
    }

    return value;
  }

  applyBehavior(
    device: DeviceRuntime,
    behavior: TimedBehavior,
    state: BehaviorState,
    now: number
  ): void {
    const bank = behavior.bank ?? 'input';

    if (behavior.type === 'randomWalk') {
      const current = Number(device.getEntryValue(bank, behavior.address));
      const direction = this.random() < 0.5 ? -1 : 1;
      const step = Number(behavior.step ?? 1);
      const min = Number(behavior.min ?? current - step);
      const max = Number(behavior.max ?? current + step);
      const nextValue = this.normalizeValueForEntry(
        device,
        bank,
        behavior.address,
        clamp(current + direction * step, min, max)
      );
      device.setEntryValue(bank, behavior.address, nextValue, { force: true });
      return;
    }

    if (behavior.type === 'sineWave') {
      const min = Number(behavior.min ?? 0);
      const max = Number(behavior.max ?? 1);
      const periodMs = Number(behavior.periodMs ?? 1000);

      if (periodMs <= 0) {
        throw new Error('sineWave behavior periodMs must be positive');
      }

      const center = (min + max) / 2;
      const amplitude = (max - min) / 2;
      const radians = ((now - state.startedAt) / periodMs) * Math.PI * 2;
      const nextValue = this.normalizeValueForEntry(
        device,
        bank,
        behavior.address,
        center + amplitude * Math.sin(radians)
      );
      device.setEntryValue(bank, behavior.address, nextValue, { force: true });
      return;
    }

    const exhaustiveCheck: never = behavior;
    throw new Error(`Unsupported behavior type "${String(exhaustiveCheck)}"`);
  }
}
