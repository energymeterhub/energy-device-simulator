import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DEVICE_PROFILE_ID,
  assertSingleDeviceConfig,
  resolveRuntimeStatePath,
  resolveSingleDeviceConfigPath,
  resolveSystemConfigPath
} from '../src/config/device-presets.ts';
import { loadConfig } from '../src/config/load-config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const deviceExamplesDir = path.resolve(__dirname, '../examples/devices');

test('single-device CLI defaults to the iammeter-wem3080t preset config', async () => {
  const configPath = resolveSingleDeviceConfigPath();
  const systemConfigPath = resolveSystemConfigPath();
  assert.equal(path.basename(configPath), `${DEFAULT_DEVICE_PROFILE_ID}.json`);

  const config = await loadConfig(configPath, {
    systemConfigPath
  });
  assertSingleDeviceConfig(config, configPath);
  assert.equal(config.devices[0]?.profileId, DEFAULT_DEVICE_PROFILE_ID);
});

test('the remaining device preset config loads exactly one device with a 2 second behavior tick', async () => {
  const systemConfigPath = resolveSystemConfigPath();
  const filenames = (await readdir(deviceExamplesDir))
    .filter((filename) => filename.endsWith('.json') && !filename.endsWith('.state.json'))
    .sort();

  assert.deepEqual(filenames, [
    'iammeter-wem3080t.dev.json',
    'iammeter-wem3080t.json',
    'shelly-3em.json'
  ]);

  for (const filename of filenames) {
    const configPath = path.join(deviceExamplesDir, filename);
    const config = await loadConfig(configPath, {
      systemConfigPath
    });

    assertSingleDeviceConfig(config, configPath);
    assert.equal(config.behaviorTickMs, 2000);
  }
});

test('runtime state files are written outside the examples directory', () => {
  const configPath = resolveSingleDeviceConfigPath('examples/devices/iammeter-wem3080t.json');
  const statePath = resolveRuntimeStatePath(configPath);

  assert.match(statePath, /\/\.runtime\//);
  assert.doesNotMatch(statePath, /\/examples\/devices\//);
});
