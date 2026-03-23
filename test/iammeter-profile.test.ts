import assert from 'node:assert/strict';
import test from 'node:test';
import { BehaviorEngine } from '../src/core/behavior-engine.ts';
import { DeviceRuntime } from '../src/core/device-runtime.ts';
import { getBuiltinProfile } from '../src/profiles/builtin.ts';
import { RegisterBank } from '../src/core/register-bank.ts';

test('iammeter-wem3080t profile exposes a continuous official 0-37 holding register block', () => {
  const profile = getBuiltinProfile('iammeter-wem3080t');
  assert.ok(profile);

  const bank = new RegisterBank(profile.device.registers);
  const raw = bank.readRange('holding', 0, 38);

  assert.equal(raw.length, 38);
  assert.equal(raw[0], 23041);
  assert.equal(raw[1], 1234);

  // Model field follows IAMMETER's documented model enum, not the marketing model string.
  assert.equal(raw[9], 2);

  // Official pad registers must exist so a single 0-37 read succeeds.
  assert.equal(raw[19], 0);
  assert.equal(raw[29], 0);
  assert.equal(raw[31], 0);

  assert.equal(bank.getEntryValue('holding', 32), 7010);
  assert.equal(bank.getEntryValue('holding', 34), 945600);
  assert.equal(bank.getEntryValue('holding', 36), 0);
});

test('iammeter-wem3080t profile changes raw power values on a 2 second interval', () => {
  const profile = getBuiltinProfile('iammeter-wem3080t');
  assert.ok(profile);

  const device = new DeviceRuntime({
    id: 'iammeter-1',
    ...profile.device
  });
  const engine = new BehaviorEngine([device], {
    tickMs: 2000,
    random: () => 0.75
  });

  const beforePhaseA = device.getEntryValue('holding', 2);
  const beforeTotal = device.getEntryValue('holding', 32);

  engine.tick(0);
  assert.equal(device.getEntryValue('holding', 2), beforePhaseA + 60);
  assert.equal(device.getEntryValue('holding', 32), beforeTotal + 90);

  engine.tick(1000);
  assert.equal(device.getEntryValue('holding', 2), beforePhaseA + 60);
  assert.equal(device.getEntryValue('holding', 32), beforeTotal + 90);

  engine.tick(2000);
  assert.equal(device.getEntryValue('holding', 2), beforePhaseA + 120);
  assert.equal(device.getEntryValue('holding', 32), beforeTotal + 180);
});
