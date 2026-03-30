import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SimulatorApp } from '../src/app/simulator-app.ts';
import { getBuiltinProfile } from '../src/profiles/builtin.ts';
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

function buildWriteMultiplePayload(address: number, values: number[]): Buffer {
  const payload = Buffer.alloc(5 + values.length * 2);
  payload.writeUInt16BE(address, 0);
  payload.writeUInt16BE(values.length, 2);
  payload.writeUInt8(values.length * 2, 4);
  values.forEach((value, index) => {
    payload.writeUInt16BE(value, 5 + index * 2);
  });
  return payload;
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve port'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

test('simulator app serves Modbus TCP and HTTP control APIs', async (t) => {
  const app = SimulatorApp.fromConfig({
    behaviorTickMs: 2000,
    controlApi: {
      enabled: true,
      host: '0.0.0.0',
      port: 0
    },
    scenarios: [],
    activeScenarioId: null,
    devices: [
      {
        id: 'meter-1',
        profileId: null,
        name: 'Meter 1',
        kind: 'meter',
        model: 'Meter 1',
        host: '0.0.0.0',
        port: 0,
        unitId: 1,
        behaviors: [],
        registers: {
          input: {
            0: {
              type: 'float32',
              value: 230.5,
              order: 'CDAB'
            }
          },
          holding: {
            100: {
              type: 'uint16',
              value: 100,
              writable: true
            },
            101: {
              type: 'uint16',
              value: 0,
              writable: true
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

  const device = app.getDevice('meter-1');
  assert.ok(device);
  const modbusPort = device.listenPort;
  const httpAddress = app.getControlApiAddress();
  assert.ok(httpAddress);

  const inputRead = await sendModbusRequest({
    host: '127.0.0.1',
    port: modbusPort,
    transactionId: 1,
    unitId: 1,
    functionCode: 0x04,
    payload: buildReadPayload(0, 2)
  });

  assert.equal(inputRead.functionCode, 0x04);
  assert.equal(inputRead.payload.readUInt8(0), 4);

  const singleWrite = await sendModbusRequest({
    host: '127.0.0.1',
    port: modbusPort,
    transactionId: 2,
    unitId: 1,
    functionCode: 0x06,
    payload: buildWriteSinglePayload(100, 88)
  });

  assert.equal(singleWrite.functionCode, 0x06);

  const multiWrite = await sendModbusRequest({
    host: '127.0.0.1',
    port: modbusPort,
    transactionId: 3,
    unitId: 1,
    functionCode: 0x10,
    payload: buildWriteMultiplePayload(100, [77, 66])
  });

  assert.equal(multiWrite.functionCode, 0x10);
  assert.equal(device.getEntryValue('holding', 100), 77);
  assert.equal(device.getEntryValue('holding', 101), 66);

  const illegalRead = await sendModbusRequest({
    host: '127.0.0.1',
    port: modbusPort,
    transactionId: 4,
    unitId: 1,
    functionCode: 0x03,
    payload: buildReadPayload(999, 1)
  });

  assert.equal(illegalRead.functionCode, 0x83);
  assert.equal(illegalRead.payload.readUInt8(0), 0x02);

  const devicesResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/devices`
  );
  assert.equal(devicesResponse.status, 200);
  const devicesBody = (await devicesResponse.json()) as {
    devices: Array<{ id: string }>;
  };
  assert.equal(devicesBody.devices.length, 1);

  const dashboardResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/dashboard`
  );
  assert.equal(dashboardResponse.status, 200);
  const dashboardBody = (await dashboardResponse.json()) as {
    device: { id: string } | null;
    snapshot: { id: string } | null;
    protocolPreview: { title: string; transport: string; sections: Array<{ id: string }> } | null;
    traffic: Array<{ protocol: string; functionCode: number | null; outcome: string }>;
  };
  assert.equal(dashboardBody.device?.id, 'meter-1');
  assert.equal(dashboardBody.snapshot?.id, 'meter-1');
  assert.equal(dashboardBody.protocolPreview, null);
  assert.ok(dashboardBody.traffic.length >= 4);
  assert.equal(dashboardBody.traffic[0]?.outcome, 'exception');
  assert.equal(dashboardBody.traffic[0]?.protocol, 'modbus-tcp');

  const trafficResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/traffic`
  );
  assert.equal(trafficResponse.status, 200);
  const trafficBody = (await trafficResponse.json()) as {
    traffic: Array<{ functionCode: number; startAddress: number | null }>;
  };
  assert.ok(trafficBody.traffic.some((entry) => entry.functionCode === 0x04));

  const rootResponse = await fetch(`http://127.0.0.1:${httpAddress.port}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(
    rootResponse.headers.get('content-type') ?? '',
    /text\/html/
  );
  const rootHtml = await rootResponse.text();
  assert.match(rootHtml, /Energy Device Simulator/);

  const registersPageResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/registers`
  );
  assert.equal(registersPageResponse.status, 200);
  const registersHtml = await registersPageResponse.text();
  assert.match(registersHtml, /Protocol Output Console/);

  const switchedPort = await reservePort();
  const switchResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/device/switch`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        manufacturerId: 'iammeter',
        productId: 'iammeter-wem3080t',
        port: switchedPort,
        unitId: 1
      })
    }
  );
  assert.equal(switchResponse.status, 200);
  const switchBody = (await switchResponse.json()) as {
    device: { profileId: string | null; configuredPort: number };
  };
  assert.equal(switchBody.device.profileId, 'iammeter-wem3080t');
  assert.equal(switchBody.device.configuredPort, switchedPort);

  const switchedRead = await sendModbusRequest({
    host: '127.0.0.1',
    port: switchedPort,
    transactionId: 5,
    unitId: 1,
    functionCode: 0x03,
    payload: buildReadPayload(0, 38)
  });
  assert.equal(switchedRead.functionCode, 0x03);
  assert.equal(switchedRead.payload.readUInt8(0), 76);

  const switchedDashboardResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/dashboard`
  );
  assert.equal(switchedDashboardResponse.status, 200);
  const switchedDashboardBody = (await switchedDashboardResponse.json()) as {
    protocolPreview: { title: string; transport: string; sections: Array<{ id: string }> } | null;
  };
  assert.equal(switchedDashboardBody.protocolPreview?.title, 'Modbus TCP Output');
  assert.equal(switchedDashboardBody.protocolPreview?.transport, 'modbus-tcp');
  assert.ok(
    switchedDashboardBody.protocolPreview?.sections.some((section) => section.id === 'holding-0-37')
  );

  const setEntryResponse = await fetch(
    `http://127.0.0.1:${httpAddress.port}/api/devices/iammeter-wem3080t-1/entries/set`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bank: 'holding',
        address: 19,
        value: 0,
        force: true
      })
    }
  );

  assert.equal(setEntryResponse.status, 200);
});

test('simulator app serves Shelly Pro 3EM RPC endpoints', async (t) => {
  const app = SimulatorApp.fromConfig({
    behaviorTickMs: 2000,
    controlApi: {
      enabled: true,
      host: '127.0.0.1',
      port: 0
    },
    scenarios: [],
    activeScenarioId: null,
    devices: [
      {
        id: 'shelly-1',
        profileId: 'shelly-3em',
        profile: 'shelly-3em',
        name: 'Shelly Pro 3EM',
        kind: 'meter',
        model: 'Shelly Pro 3EM',
        transport: 'shelly-rpc-http',
        host: '127.0.0.1',
        port: 0,
        unitId: 1,
        behaviors: [],
        registers: {
          input: {
            0: { type: 'float32', value: 610.1 },
            2: { type: 'float32', value: 0.971 },
            4: { type: 'float32', value: 230.2 },
            6: { type: 'float32', value: 12034.5 },
            8: { type: 'float32', value: 6.7 },
            20: { type: 'float32', value: 420.4 },
            22: { type: 'float32', value: 0.953 },
            24: { type: 'float32', value: 229.8 },
            26: { type: 'float32', value: 9234.1 },
            28: { type: 'float32', value: 3.2 },
            40: { type: 'float32', value: 310.8 },
            42: { type: 'float32', value: 0.944 },
            44: { type: 'float32', value: 228.6 },
            46: { type: 'float32', value: 8345.2 },
            48: { type: 'float32', value: 2.1 }
          }
        }
      }
    ]
  });

  await app.start();
  t.after(async () => {
    await app.stop();
  });

  const device = app.getDevice('shelly-1');
  assert.ok(device);
  const httpPort = device.listenPort;
  const controlAddress = app.getControlApiAddress();
  assert.ok(controlAddress);

  const emStatusResponse = await fetch(`http://127.0.0.1:${httpPort}/rpc/EM.GetStatus?id=0`);
  assert.equal(emStatusResponse.status, 200);
  const emStatusBody = (await emStatusResponse.json()) as {
    a_voltage: number;
    b_voltage: number;
    c_voltage: number;
    total_act_power: number;
    c_active_power: number;
  };
  assert.equal(emStatusBody.a_voltage, 230.2);
  assert.equal(emStatusBody.b_voltage, 229.8);
  assert.equal(emStatusBody.c_voltage, 228.6);
  assert.ok((emStatusBody.total_act_power ?? 0) > 1000);
  assert.equal(emStatusBody.c_active_power, 310.8);

  const emDataResponse = await fetch(`http://127.0.0.1:${httpPort}/rpc/EMData.GetStatus?id=0`);
  assert.equal(emDataResponse.status, 200);
  const emDataBody = (await emDataResponse.json()) as {
    a_total_act_energy: number;
    b_total_act_energy: number;
    c_total_act_energy: number;
    total_act: number;
    total_act_ret: number;
  };
  assert.equal(emDataBody.a_total_act_energy, 12034.5);
  assert.equal(emDataBody.b_total_act_energy, 9234.1);
  assert.equal(emDataBody.c_total_act_energy, 8345.2);
  assert.ok((emDataBody.total_act ?? 0) > 29000);
  assert.ok((emDataBody.total_act_ret ?? 0) > 10);

  const dashboardResponse = await fetch(`http://127.0.0.1:${controlAddress.port}/api/dashboard`);
  assert.equal(dashboardResponse.status, 200);
  const dashboardBody = (await dashboardResponse.json()) as {
    device: { id: string; transport: string } | null;
    protocolPreview: { title: string; sections: Array<{ id: string }> } | null;
    traffic: Array<{ protocol: string; method: string | null; requestTarget: string | null }>;
  };
  assert.equal(dashboardBody.device?.id, 'shelly-1');
  assert.equal(dashboardBody.device?.transport, 'shelly-rpc-http');
  assert.equal(dashboardBody.protocolPreview?.title, 'Shelly Pro 3EM RPC Output');
  assert.ok(dashboardBody.protocolPreview?.sections.some((section) => section.id === 'em-status'));
  assert.ok(
    dashboardBody.traffic.some(
      (entry) => entry.protocol === 'http' && entry.requestTarget === '/rpc/EM.GetStatus?id=0'
    )
  );

  const switchResponse = await fetch(`http://127.0.0.1:${controlAddress.port}/api/device/switch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      productId: 'shelly-3em',
      port: await reservePort(),
      unitId: 1
    })
  });
  assert.equal(switchResponse.status, 200);
  const switchBody = (await switchResponse.json()) as {
    device: { profileId: string | null; transport: string; configuredPort: number };
  };
  assert.equal(switchBody.device.profileId, 'shelly-3em');
  assert.equal(switchBody.device.transport, 'shelly-rpc-http');
  assert.ok(switchBody.device.configuredPort > 0);
});

test('simulator app persists the selected profile across restarts', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'energy-device-simulator-'));
  const stateFilePath = path.join(stateDir, 'selection-state.json');
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  const baseConfig = {
    behaviorTickMs: 2000,
    controlApi: {
      enabled: false,
      host: '127.0.0.1',
      port: 0
    },
    scenarios: [],
    activeScenarioId: null,
    devices: [
      {
        id: 'meter-1',
        profileId: 'iammeter-wem3080t',
        profile: 'iammeter-wem3080t',
        name: 'IAMMETER WEM3080T',
        kind: 'meter',
        model: 'WEM3080T',
        transport: 'modbus-tcp' as const,
        host: '127.0.0.1',
        port: await reservePort(),
        unitId: 1,
        behaviors: [],
        registers: {
          holding: {},
          input: {}
        }
      }
    ]
  };

  const firstApp = SimulatorApp.fromConfig(baseConfig, { stateFilePath });
  await firstApp.start();
  const switchedPort = await reservePort();
  await firstApp.switchDeviceProfile({
    profileId: 'shelly-3em',
    port: switchedPort
  });
  await firstApp.stop();

  const persistedState = JSON.parse(await readFile(stateFilePath, 'utf8')) as {
    version: number;
    selectedProfileId: string;
  };
  assert.equal(persistedState.version, 2);
  assert.equal(persistedState.selectedProfileId, 'shelly-3em');

  const secondApp = SimulatorApp.fromConfig(baseConfig, { stateFilePath });
  const restoredDevice = secondApp.getPrimaryDeviceSummary();
  assert.equal(restoredDevice?.profileId, 'shelly-3em');
  assert.equal(restoredDevice?.transport, 'shelly-rpc-http');
  assert.notEqual(restoredDevice?.configuredPort, switchedPort);
  assert.equal(restoredDevice?.configuredPort, 18080);
});

test('simulator app exposes Fronius SunSpec protocol preview sections', async (t) => {
  const profile = getBuiltinProfile('fronius-sunspec');
  assert.ok(profile);

  const app = SimulatorApp.fromConfig({
    behaviorTickMs: 2000,
    controlApi: {
      enabled: true,
      host: '127.0.0.1',
      port: 0
    },
    scenarios: [],
    activeScenarioId: null,
    devices: [
      {
        id: 'fronius-1',
        profileId: 'fronius-sunspec',
        profile: 'fronius-sunspec',
        name: 'Fronius SunSpec Inverter',
        kind: 'inverter',
        model: 'Fronius SunSpec Inverter',
        transport: 'modbus-tcp',
        host: '127.0.0.1',
        port: 0,
        unitId: 1,
        behaviors: [],
        registers: profile.device.registers ?? {}
      }
    ]
  });

  await app.start();
  t.after(async () => {
    await app.stop();
  });

  const controlAddress = app.getControlApiAddress();
  assert.ok(controlAddress);

  const dashboardResponse = await fetch(`http://127.0.0.1:${controlAddress.port}/api/dashboard`);
  assert.equal(dashboardResponse.status, 200);
  const dashboardBody = (await dashboardResponse.json()) as {
    protocolPreview: { title: string; sections: Array<{ id: string }> } | null;
  };

  assert.equal(dashboardBody.protocolPreview?.title, 'Modbus TCP Output');
  assert.ok(
    dashboardBody.protocolPreview?.sections.some((section) => section.id === 'sunspec-signature')
  );
  assert.ok(
    dashboardBody.protocolPreview?.sections.some((section) => section.id === 'sunspec-common')
  );
  assert.ok(
    dashboardBody.protocolPreview?.sections.some((section) => section.id === 'sunspec-inverter-103')
  );
});
