#!/usr/bin/env node
import process from 'node:process';
import { SimulatorApp } from './app/simulator-app.ts';
import { formatMeterReading, readBuiltinMeterProfile } from './clients/meter-reader.ts';
import {
  assertSingleDeviceConfig,
  DEFAULT_DEVICE_PROFILE_ID,
  resolveRuntimeStatePath,
  resolveSingleDeviceConfigPath,
  resolveSystemConfigPath
} from './config/device-presets.ts';
import { loadConfig } from './config/load-config.ts';
import { ModbusTcpClient } from './modbus/client.ts';

function printUsage(): void {
  console.log('Usage:');
  console.log(
    '  node --experimental-strip-types src/cli.ts start [profile-id|config.json]'
  );
  console.log(
    '  node --experimental-strip-types src/cli.ts validate [profile-id|config.json]'
  );
  console.log(
    '  node --experimental-strip-types src/cli.ts start [profile-id|config.json] [--system examples/system/default.json]'
  );
  console.log(
    '  node --experimental-strip-types src/cli.ts read-meter [--host 127.0.0.1] [--port 502] [--unit 1] [--profile iammeter-wem3080t] [--json]'
  );
  console.log(`Default profile: ${DEFAULT_DEVICE_PROFILE_ID}`);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return flags;
}

function getFirstPositional(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      return token;
    }

    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      index += 1;
    }
  }

  return undefined;
}

async function startCommand(target?: string, systemTarget?: string): Promise<void> {
  const resolvedPath = resolveSingleDeviceConfigPath(target);
  const systemConfigPath = resolveSystemConfigPath(systemTarget);
  const config = await loadConfig(resolvedPath, {
    systemConfigPath
  });
  assertSingleDeviceConfig(config, resolvedPath);
  const app = SimulatorApp.fromConfig(config, {
    stateFilePath: resolveRuntimeStatePath(resolvedPath)
  });
  await app.start();

  console.log('Energy Device Simulator started');
  console.log(`System: ${systemConfigPath}`);
  console.log(`Device: ${resolvedPath}`);
  console.log(`State: ${resolveRuntimeStatePath(resolvedPath)}`);

  for (const device of app.listDevices()) {
    console.log(
      `- ${device.id} (${device.kind}) unitId=${device.unitId} transport=${device.transport} listen=${device.host}:${device.port}`
    );
  }

  const controlApiAddress = app.getControlApiAddress();
  if (controlApiAddress) {
    console.log(`- controlApi=http://${controlApiAddress.address}:${controlApiAddress.port}`);
  }

  const protocolPreview = app.getDashboard().protocolPreview;
  if (protocolPreview?.debugHints.length) {
    console.log(`- protocol=${protocolPreview.title}`);
    for (const hint of protocolPreview.debugHints) {
      console.log(`  ${hint}`);
    }
  }

  let shuttingDown = false;
  const shutdownAsync = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await app.stop();
    process.exit(0);
  };

  const shutdown = (): void => {
    void shutdownAsync();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function validateCommand(target?: string, systemTarget?: string): Promise<void> {
  const resolvedPath = resolveSingleDeviceConfigPath(target);
  const systemConfigPath = resolveSystemConfigPath(systemTarget);
  const config = await loadConfig(resolvedPath, {
    systemConfigPath
  });
  assertSingleDeviceConfig(config, resolvedPath);
  console.log(`System OK: ${systemConfigPath}`);
  console.log(`Device OK: ${resolvedPath}`);
}

async function readMeterCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1';
  const port = typeof flags.port === 'string' ? Number(flags.port) : 502;
  const unitId = typeof flags.unit === 'string' ? Number(flags.unit) : 1;
  const profileId = typeof flags.profile === 'string' ? flags.profile : 'iammeter-wem3080t';

  const client = new ModbusTcpClient({
    host,
    port,
    unitId
  });

  const reading = await readBuiltinMeterProfile(client, profileId);
  if (flags.json === true) {
    console.log(JSON.stringify(reading, null, 2));
    return;
  }

  console.log(formatMeterReading(reading));
}

async function main(): Promise<void> {
  const [command = 'start', ...args] = process.argv.slice(2);
  const flags = parseFlags(args);
  const target = getFirstPositional(args);
  const systemTarget = typeof flags.system === 'string' ? flags.system : undefined;

  if (command === 'start') {
    await startCommand(target, systemTarget);
    return;
  }

  if (command === 'validate') {
    await validateCommand(target, systemTarget);
    return;
  }

  if (command === 'read-meter') {
    await readMeterCommand(args);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
