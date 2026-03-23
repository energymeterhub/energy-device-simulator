import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulatorApp } from '../src/app/simulator-app.ts';
import { normalizeConfig } from '../src/config/load-config.ts';
import { sendModbusRequest } from './helpers/modbus-client.ts';

function buildReadPayload(startAddress: number, quantity: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt16BE(startAddress, 0);
  payload.writeUInt16BE(quantity, 2);
  return payload;
}

function buildWriteSinglePayload(address: number, value: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt16BE(address, 0);
  payload.writeUInt16BE(value, 2);
  return payload;
}

test('profiles, scenarios, faults, and writes work end to end', async (t) => {
  const app = SimulatorApp.fromConfig(
    normalizeConfig({
      behaviorTickMs: 500,
      controlApi: {
        enabled: true,
        host: '0.0.0.0',
        port: 0
      },
      scenarios: [
        {
          id: 'offline-mode',
          patches: [
            {
              deviceId: 'iammeter-1',
              faults: [
                {
                  id: 'offline-1',
                  type: 'offline',
                  exceptionCode: 4
                }
              ]
            }
          ]
        }
      ],
      devices: [
        {
          id: 'iammeter-1',
          profile: 'iammeter-wem3080t',
          host: '0.0.0.0',
          port: 0,
          registers: {
            holding: {
              19: {
                type: 'uint16',
                value: 0,
                writable: true
              }
            }
          }
        }
      ]
    })
  );

  await app.start();
  t.after(async () => {
    await app.stop();
  });

  const device = app.getDevice('iammeter-1');
  assert.ok(device);
  const httpAddress = app.getControlApiAddress();
  assert.ok(httpAddress);

  const profilesResponse = await fetch(`http://127.0.0.1:${httpAddress.port}/api/profiles`);
  assert.equal(profilesResponse.status, 200);
  const profilesBody = (await profilesResponse.json()) as {
    profiles: Array<{ id: string }>;
  };
  assert.deepEqual(
    profilesBody.profiles.map((profile) => profile.id),
    ['iammeter-wem3080t', 'shelly-3em']
  );

  const scenariosResponse = await fetch(`http://127.0.0.1:${httpAddress.port}/api/scenarios`);
  const scenariosBody = (await scenariosResponse.json()) as {
    scenarios: Array<{ id: string }>;
    activeScenarioId: string | null;
  };
  assert.equal(scenariosBody.activeScenarioId, null);
  assert.equal(scenariosBody.scenarios[0]?.id, 'offline-mode');

  const applyScenarioResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/scenarios/apply`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id: 'offline-mode' })
    }
  );
  assert.equal(applyScenarioResponse.status, 200);

  const modbusPort = device.listenPort;
  const offlineRead = await sendModbusRequest({
    host: '127.0.0.1',
    port: modbusPort,
    functionCode: 0x04,
    payload: buildReadPayload(0, 2)
  });
  assert.equal(offlineRead.functionCode, 0x84);
  assert.equal(offlineRead.payload.readUInt8(0), 0x04);

  const resetScenarioResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/scenarios/reset`,
    {
      method: 'POST'
    }
  );
  assert.equal(resetScenarioResponse.status, 200);

  const writePadRegister = await sendModbusRequest({
    host: '127.0.0.1',
    port: modbusPort,
    functionCode: 0x06,
    payload: buildWriteSinglePayload(19, 9)
  });
  assert.equal(writePadRegister.functionCode, 0x06);
  assert.equal(device.getEntryValue('holding', 19), 9);

  const setFaultResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/devices/iammeter-1/faults/apply`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: 'freeze-test',
        type: 'freeze'
      })
    }
  );
  assert.equal(setFaultResponse.status, 200);
  assert.equal(device.listFaults().length, 1);

  const clearFaultResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/devices/iammeter-1/faults/clear`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: ['freeze-test']
      })
    }
  );
  assert.equal(clearFaultResponse.status, 200);
  assert.equal(device.listFaults().length, 0);

  const resetDeviceResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/devices/iammeter-1/reset`,
    {
      method: 'POST'
    }
  );
  assert.equal(resetDeviceResponse.status, 200);
  assert.equal(device.getEntryValue('holding', 19), 0);
});
