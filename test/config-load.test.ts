import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig, normalizeConfig } from '../src/config/load-config.ts';
import { resolveSystemConfigPath } from '../src/config/device-presets.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('normalizeConfig resolves the IAMMETER builtin profile and scenario definitions', () => {
  const config = normalizeConfig({
    behaviorTickMs: 250,
    controlApi: {
      enabled: true,
      host: '127.0.0.1',
      port: 0
    },
    scenarios: [
      {
        id: 'night-idle',
        patches: [
          {
            deviceId: 'meter-1',
            behaviorMode: 'paused',
            entryValues: [
              {
                kind: 'setEntryValue',
                bank: 'holding',
                address: 19,
                value: 300,
                force: true
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
        port: 502
      }
    ]
  });

  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0]?.profileId, 'iammeter-wem3080t');
  assert.equal(config.devices[0]?.kind, 'meter');
  assert.equal(config.devices[0]?.model, 'IAMMETER WEM3080T');
  assert.ok((config.devices[0]?.behaviors.length ?? 0) >= 4);
  assert.equal(config.scenarios.length, 1);
  assert.equal(config.scenarios[0]?.id, 'night-idle');
});

test('normalizeConfig resolves the Shelly Pro 3EM builtin profile with RPC transport', () => {
  const config = normalizeConfig({
    devices: [
      {
        id: 'shelly-1',
        profile: 'shelly-3em',
        host: '0.0.0.0'
      }
    ]
  });

  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0]?.profileId, 'shelly-3em');
  assert.equal(config.devices[0]?.transport, 'shelly-rpc-http');
  assert.equal(config.devices[0]?.model, 'Shelly Pro 3EM');
  assert.equal(config.devices[0]?.port, 18080);
});

test('loadConfig merges a shared system config with a single device file', async () => {
  const systemConfigPath = resolveSystemConfigPath();
  const deviceConfigPath = path.resolve(__dirname, '../examples/devices/iammeter-wem3080t.json');

  const config = await loadConfig(deviceConfigPath, {
    systemConfigPath
  });

  assert.equal(config.behaviorTickMs, 2000);
  assert.equal(config.controlApi.port, 5092);
  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0]?.profileId, 'iammeter-wem3080t');
  assert.equal(config.devices[0]?.port, 502);
});

test('loadConfig reads the non-privileged IAMMETER dev example device config', async () => {
  const systemConfigPath = resolveSystemConfigPath();
  const deviceConfigPath = path.resolve(__dirname, '../examples/devices/iammeter-wem3080t.dev.json');

  const config = await loadConfig(deviceConfigPath, {
    systemConfigPath
  });

  assert.equal(config.behaviorTickMs, 2000);
  assert.equal(config.controlApi.port, 5092);
  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0]?.profileId, 'iammeter-wem3080t');
  assert.equal(config.devices[0]?.port, 1502);
});

test('loadConfig reads the Shelly example device config', async () => {
  const systemConfigPath = resolveSystemConfigPath();
  const deviceConfigPath = path.resolve(__dirname, '../examples/devices/shelly-3em.json');

  const config = await loadConfig(deviceConfigPath, {
    systemConfigPath
  });

  assert.equal(config.behaviorTickMs, 2000);
  assert.equal(config.controlApi.port, 5092);
  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0]?.profileId, 'shelly-3em');
  assert.equal(config.devices[0]?.transport, 'shelly-rpc-http');
  assert.equal(config.devices[0]?.port, 18080);
});
