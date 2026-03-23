import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuiltinProfile, resolveBuiltinProfileId } from '../profiles/builtin.ts';
import type { SimulatorConfig } from '../types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RUNTIME_STATE_DIR = path.join(PROJECT_ROOT, '.runtime');

export const DEFAULT_DEVICE_PROFILE_ID = 'iammeter-wem3080t';
export const DEFAULT_SYSTEM_CONFIG_NAME = 'default';

export function getBuiltinDeviceConfigPath(profileId: string): string | null {
  const resolvedProfileId = resolveBuiltinProfileId(profileId);
  if (!getBuiltinProfile(resolvedProfileId)) {
    return null;
  }

  return path.resolve(__dirname, `../../examples/devices/${resolvedProfileId}.json`);
}

export function resolveSingleDeviceConfigPath(target?: string): string {
  const effectiveTarget = target ?? DEFAULT_DEVICE_PROFILE_ID;
  const builtinPath = getBuiltinDeviceConfigPath(effectiveTarget);

  if (builtinPath) {
    return builtinPath;
  }

  if (path.isAbsolute(effectiveTarget)) {
    return effectiveTarget;
  }

  return path.resolve(process.cwd(), effectiveTarget);
}

export function resolveSystemConfigPath(target = DEFAULT_SYSTEM_CONFIG_NAME): string {
  if (path.isAbsolute(target)) {
    return target;
  }

  if (target.endsWith('.json') || target.includes('/')) {
    return path.resolve(process.cwd(), target);
  }

  return path.resolve(__dirname, `../../examples/system/${target}.json`);
}

export function resolveRuntimeStatePath(deviceConfigPath: string): string {
  const resolvedPath = path.resolve(deviceConfigPath);
  const baseName = path.basename(resolvedPath, path.extname(resolvedPath));
  const digest = createHash('sha1').update(resolvedPath).digest('hex').slice(0, 10);
  return path.join(RUNTIME_STATE_DIR, `${baseName}.${digest}.state.json`);
}

export function assertSingleDeviceConfig(config: SimulatorConfig, source: string): void {
  if (config.devices.length !== 1) {
    throw new Error(
      `${source} must define exactly one device for CLI startup; found ${config.devices.length}`
    );
  }
}
