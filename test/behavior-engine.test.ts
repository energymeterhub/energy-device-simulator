import assert from 'node:assert/strict';
import test from 'node:test';
import { BehaviorEngine } from '../src/core/behavior-engine.ts';
import { DeviceRuntime } from '../src/core/device-runtime.ts';

test('randomWalk behavior updates a typed register deterministically', () => {
  const device = new DeviceRuntime({
    id: 'meter-1',
    port: 1502,
    unitId: 1,
    registers: {
      input: {
        0: {
          type: 'int32',
          value: 3000
        }
      }
    },
    behaviors: [
      {
        type: 'randomWalk',
        bank: 'input',
        address: 0,
        min: 2900,
        max: 3100,
        step: 50,
        intervalMs: 1000
      }
    ]
  });

  const engine = new BehaviorEngine([device], {
    tickMs: 200,
    random: () => 0.75
  });

  engine.tick(1000);
  assert.equal(device.getEntryValue('input', 0), 3050);

  engine.tick(1500);
  assert.equal(device.getEntryValue('input', 0), 3050);

  engine.tick(2100);
  assert.equal(device.getEntryValue('input', 0), 3100);
});

test('sineWave behavior stays within configured bounds', () => {
  const device = new DeviceRuntime({
    id: 'inverter-1',
    port: 1502,
    unitId: 1,
    registers: {
      input: {
        0: {
          type: 'float32',
          value: 0
        }
      }
    },
    behaviors: [
      {
        type: 'sineWave',
        bank: 'input',
        address: 0,
        min: 1000,
        max: 2000,
        periodMs: 1000,
        intervalMs: 100
      }
    ]
  });

  const engine = new BehaviorEngine([device], {
    tickMs: 100
  });

  engine.tick(0);
  const first = device.getEntryValue('input', 0);
  engine.tick(250);
  const second = device.getEntryValue('input', 0);

  assert.ok(first >= 1000 && first <= 2000);
  assert.ok(second >= 1000 && second <= 2000);
});

test('sineWave behavior rounds values for integer registers', () => {
  const device = new DeviceRuntime({
    id: 'inverter-2',
    port: 1502,
    unitId: 1,
    registers: {
      input: {
        4: {
          type: 'int32',
          value: 3400
        }
      }
    },
    behaviors: [
      {
        type: 'sineWave',
        bank: 'input',
        address: 4,
        min: 2800,
        max: 4200,
        periodMs: 1000,
        intervalMs: 100
      }
    ]
  });

  const engine = new BehaviorEngine([device], {
    tickMs: 100
  });

  engine.tick(0);
  const first = device.getEntryValue('input', 4);
  engine.tick(250);
  const second = device.getEntryValue('input', 4);

  assert.equal(Number.isInteger(first), true);
  assert.equal(Number.isInteger(second), true);
  assert.ok(first >= 2800 && first <= 4200);
  assert.ok(second >= 2800 && second <= 4200);
});
