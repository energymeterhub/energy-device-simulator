import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulatorApp } from '../src/app/simulator-app.ts';
import { readBuiltinMeterProfile } from '../src/clients/meter-reader.ts';
import { ModbusExceptionError, ModbusTcpClient } from '../src/modbus/client.ts';

function assertClose(actual: number, expected: number, epsilon = 0.0001): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be close to ${expected}`);
}

test('ModbusTcpClient reads IAMMETER WEM3080T values from holding registers', async (t) => {
  const app = SimulatorApp.fromConfig({
    behaviorTickMs: 5000,
    controlApi: {
      enabled: false,
      host: '127.0.0.1',
      port: 0
    },
    scenarios: [],
    activeScenarioId: null,
    devices: [
      {
        id: 'iammeter-1',
        profileId: 'iammeter-wem3080t',
        name: 'IAMMETER WEM3080T',
        kind: 'meter',
        model: 'IAMMETER WEM3080T',
        host: '0.0.0.0',
        port: 0,
        unitId: 1,
        behaviors: [],
        registers: {
          holding: {
            0: { type: 'uint16', value: 23041 },
            1: { type: 'uint16', value: 1234 },
            2: { type: 'int32', value: 2810 },
            10: { type: 'uint16', value: 22995 },
            11: { type: 'uint16', value: 1010 },
            12: { type: 'int32', value: 2260 },
            19: { type: 'uint16', value: 0, writable: true },
            20: { type: 'uint16', value: 23112 },
            21: { type: 'uint16', value: 850 },
            22: { type: 'int32', value: 1940 },
            30: { type: 'uint16', value: 5000 },
            32: { type: 'int32', value: 7010 }
          }
        }
      }
    ]
  });

  await app.start();
  t.after(async () => {
    await app.stop();
  });

  const device = app.getDevice('iammeter-1');
  assert.ok(device);

  const client = new ModbusTcpClient({
    host: '127.0.0.1',
    port: device.listenPort,
    unitId: 1
  });

  const reading = await readBuiltinMeterProfile(client, 'iammeter-wem3080t');

  assertClose(reading.values.phaseAVoltage, 230.41);
  assertClose(reading.values.phaseACurrent, 12.34);
  assert.equal(reading.values.phaseAActivePower, 2810);
  assertClose(reading.values.phaseBVoltage, 229.95);
  assertClose(reading.values.phaseBCurrent, 10.1);
  assert.equal(reading.values.phaseBActivePower, 2260);
  assertClose(reading.values.phaseCVoltage, 231.12);
  assertClose(reading.values.phaseCCurrent, 8.5);
  assert.equal(reading.values.phaseCActivePower, 1940);
  assertClose(reading.values.frequency, 50);
  assert.equal(reading.values.totalPower, 7010);
  assert.equal(reading.rawValues.totalPower, 7010);

  await client.writeSingleRegister(19, 88);
  const updatedValue = await client.readValue({
    bank: 'holding',
    address: 19,
    type: 'uint16'
  });

  assert.equal(updatedValue, 88);
});

test('ModbusTcpClient throws a typed exception for illegal addresses', async (t) => {
  const app = SimulatorApp.fromConfig({
    behaviorTickMs: 5000,
    controlApi: {
      enabled: false,
      host: '127.0.0.1',
      port: 0
    },
    scenarios: [],
    activeScenarioId: null,
    devices: [
      {
        id: 'iammeter-1',
        profileId: null,
        name: 'IAMMETER WEM3080T',
        kind: 'meter',
        model: 'IAMMETER WEM3080T',
        host: '0.0.0.0',
        port: 0,
        unitId: 1,
        behaviors: [],
        registers: {
          holding: {
            0: {
              type: 'uint16',
              value: 23041
            }
          }
        }
      }
    ]
  });

  await app.start();
  t.after(async () => {
    await app.stop();
  });

  const device = app.getDevice('iammeter-1');
  assert.ok(device);

  const client = new ModbusTcpClient({
    host: '127.0.0.1',
    port: device.listenPort,
    unitId: 1
  });

  await assert.rejects(
    client.readHoldingRegisters(1000, 1),
    (error: unknown) =>
      error instanceof ModbusExceptionError &&
      error.functionCode === 0x03 &&
      error.exceptionCode === 0x02
  );
});
