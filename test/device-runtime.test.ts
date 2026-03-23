import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceRuntime } from '../src/core/device-runtime.ts';

test('device runtime applies onWriteTrigger actions and resets back to baseline', () => {
  const device = new DeviceRuntime({
    id: 'device-1',
    profile: 'test-profile',
    name: 'Device 1',
    kind: 'meter',
    model: 'Device 1',
    host: '0.0.0.0',
    port: 1502,
    unitId: 1,
    registers: {
      input: {
        0: {
          type: 'int32',
          value: 0
        }
      },
      holding: {
        100: {
          type: 'uint16',
          value: 10,
          writable: true
        }
      }
    },
    behaviors: [
      {
        type: 'onWriteTrigger',
        bank: 'holding',
        address: 100,
        actions: [
          {
            kind: 'setEntryValue',
            bank: 'input',
            address: 0,
            fromWritten: {
              source: 'writtenValue',
              multiply: 10,
              round: 'round'
            },
            force: true
          }
        ]
      }
    ]
  });

  device.setEntryValue('holding', 100, 25);
  assert.equal(device.getEntryValue('input', 0), 250);

  device.applyFault({
    id: 'freeze-1',
    type: 'freeze'
  });
  assert.equal(device.shouldRunBehaviors(), false);

  device.resetRuntimeState();
  assert.equal(device.getEntryValue('holding', 100), 10);
  assert.equal(device.getEntryValue('input', 0), 0);
  assert.equal(device.listFaults().length, 0);
});
