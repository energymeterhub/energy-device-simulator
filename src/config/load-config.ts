import { readFile } from 'node:fs/promises';
import { getBuiltinProfile } from '../profiles/builtin.ts';
import type {
  ControlApiConfig,
  DeviceBehavior,
  DeviceConfig,
  DeviceConfigInput,
  DeviceFault,
  DeviceRegistersDefinition,
  DeviceScenarioPatch,
  DeviceTransport,
  RegisterBankName,
  ScenarioDefinition,
  SetEntryValueAction,
  SetRawRegistersAction,
  SimulatorConfig
} from '../types.ts';

const SUPPORTED_BEHAVIORS: Set<DeviceBehavior['type']> = new Set([
  'randomWalk',
  'sineWave',
  'onWriteTrigger'
]);

type UnknownRecord = Record<string, unknown>;

function assertObject(value: unknown, label: string): asserts value is UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertPositiveInteger(
  value: unknown,
  label: string,
  options: { allowZero?: boolean } = {}
): number {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  if (options.allowZero !== true && numericValue === 0) {
    throw new Error(`${label} must be greater than zero`);
  }

  return numericValue;
}

function normalizeBank(
  value: unknown,
  label: string,
  fallback: RegisterBankName
): RegisterBankName {
  if (value == null) {
    return fallback;
  }

  if (value === 'holding' || value === 'input') {
    return value;
  }

  throw new Error(`${label} must be "holding" or "input"`);
}

function normalizeOptionalNumber(value: unknown, label: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${label} must be a finite number`);
  }

  return numericValue;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function normalizeTransport(value: unknown, fallback: DeviceTransport): DeviceTransport {
  if (value == null) {
    return fallback;
  }

  if (value === 'modbus-tcp' || value === 'shelly-gen1-http') {
    return value;
  }

  throw new Error('Device transport must be "modbus-tcp" or "shelly-gen1-http"');
}

function normalizeRegisters(rawRegisters: unknown): DeviceRegistersDefinition {
  if (rawRegisters == null) {
    return {};
  }

  assertObject(rawRegisters, 'Device registers');
  return structuredClone(rawRegisters as DeviceRegistersDefinition);
}

function mergeRegisters(
  baseRegisters: DeviceRegistersDefinition = {},
  overrideRegisters: DeviceRegistersDefinition = {}
): DeviceRegistersDefinition {
  const merged: DeviceRegistersDefinition = {};

  for (const bank of ['holding', 'input'] as const) {
    const hasBase = baseRegisters[bank] != null;
    const hasOverride = overrideRegisters[bank] != null;

    if (!hasBase && !hasOverride) {
      continue;
    }

    merged[bank] = {
      ...(baseRegisters[bank] ?? {}),
      ...(overrideRegisters[bank] ?? {})
    };
  }

  return merged;
}

function normalizeSetEntryAction(rawAction: unknown, label: string): SetEntryValueAction {
  assertObject(rawAction, label);
  if (rawAction.kind !== 'setEntryValue') {
    throw new Error(`${label} kind must be "setEntryValue"`);
  }

  return {
    kind: 'setEntryValue',
    bank: normalizeBank(rawAction.bank, `${label} bank`, 'holding'),
    address: assertPositiveInteger(rawAction.address, `${label} address`, {
      allowZero: true
    }),
    value:
      rawAction.value == null
        ? undefined
        : Number(normalizeOptionalNumber(rawAction.value, `${label} value`)),
    fromWritten:
      rawAction.fromWritten == null
        ? undefined
        : normalizeValueFromWritten(rawAction.fromWritten, `${label} fromWritten`),
    force: rawAction.force === true
  };
}

function normalizeRawWriteAction(rawAction: unknown, label: string): SetRawRegistersAction {
  assertObject(rawAction, label);

  if (rawAction.kind !== 'setRawRegisters') {
    throw new Error(`${label} kind must be "setRawRegisters"`);
  }

  if (!Array.isArray(rawAction.values) || rawAction.values.length === 0) {
    throw new Error(`${label} values must be a non-empty array`);
  }

  return {
    kind: 'setRawRegisters',
    bank: normalizeBank(rawAction.bank, `${label} bank`, 'holding'),
    address: assertPositiveInteger(rawAction.address, `${label} address`, {
      allowZero: true
    }),
    values: rawAction.values.map((value, index) =>
      assertPositiveInteger(value, `${label} values[${index}]`, {
        allowZero: true
      })
    ),
    force: rawAction.force === true
  };
}

function normalizeValueFromWritten(rawValue: unknown, label: string) {
  assertObject(rawValue, label);

  if (rawValue.source !== 'writtenValue') {
    throw new Error(`${label} source must be "writtenValue"`);
  }

  return {
    source: 'writtenValue' as const,
    multiply: normalizeOptionalNumber(rawValue.multiply, `${label} multiply`),
    offset: normalizeOptionalNumber(rawValue.offset, `${label} offset`),
    min: normalizeOptionalNumber(rawValue.min, `${label} min`),
    max: normalizeOptionalNumber(rawValue.max, `${label} max`),
    round:
      rawValue.round == null
        ? undefined
        : normalizeTriggerRound(rawValue.round, `${label} round`)
  };
}

function normalizeTriggerRound(
  value: unknown,
  label: string
): 'none' | 'round' | 'floor' | 'ceil' {
  if (value === 'none' || value === 'round' || value === 'floor' || value === 'ceil') {
    return value;
  }

  throw new Error(`${label} must be one of none, round, floor, ceil`);
}

function normalizeBehavior(rawBehavior: unknown): DeviceBehavior {
  assertObject(rawBehavior, 'Behavior');

  const type = rawBehavior.type;
  if (typeof type !== 'string' || !SUPPORTED_BEHAVIORS.has(type as DeviceBehavior['type'])) {
    throw new Error(`Unsupported behavior type "${String(rawBehavior.type)}"`);
  }

  const base = {
    id: typeof rawBehavior.id === 'string' ? rawBehavior.id : undefined,
    bank: normalizeBank(rawBehavior.bank, 'Behavior bank', 'input'),
    address: assertPositiveInteger(rawBehavior.address, 'Behavior address', {
      allowZero: true
    })
  };

  if (type === 'randomWalk') {
    return {
      ...base,
      type: 'randomWalk',
      intervalMs:
        rawBehavior.intervalMs == null
          ? undefined
          : assertPositiveInteger(rawBehavior.intervalMs, 'Behavior intervalMs'),
      min: normalizeOptionalNumber(rawBehavior.min, 'Behavior min'),
      max: normalizeOptionalNumber(rawBehavior.max, 'Behavior max'),
      step: normalizeOptionalNumber(rawBehavior.step, 'Behavior step')
    };
  }

  if (type === 'sineWave') {
    return {
      ...base,
      type: 'sineWave',
      intervalMs:
        rawBehavior.intervalMs == null
          ? undefined
          : assertPositiveInteger(rawBehavior.intervalMs, 'Behavior intervalMs'),
      min: normalizeOptionalNumber(rawBehavior.min, 'Behavior min'),
      max: normalizeOptionalNumber(rawBehavior.max, 'Behavior max'),
      periodMs:
        rawBehavior.periodMs == null
          ? undefined
          : assertPositiveInteger(rawBehavior.periodMs, 'Behavior periodMs')
    };
  }

  if (!Array.isArray(rawBehavior.actions) || rawBehavior.actions.length === 0) {
    throw new Error('onWriteTrigger behavior actions must be a non-empty array');
  }

  return {
    ...base,
    type: 'onWriteTrigger',
    actions: rawBehavior.actions.map((action, index) =>
      normalizeSetEntryAction(action, `Behavior actions[${index}]`)
    )
  };
}

function normalizeControlApi(rawControlApi: unknown): ControlApiConfig {
  if (rawControlApi == null) {
    return {
      enabled: true,
      host: '127.0.0.1',
      port: 0
    };
  }

  assertObject(rawControlApi, 'controlApi');

  return {
    enabled: rawControlApi.enabled !== false,
    host: normalizeString(rawControlApi.host, '127.0.0.1'),
    port:
      rawControlApi.port == null
        ? 0
        : assertPositiveInteger(rawControlApi.port, 'controlApi.port', {
            allowZero: true
          })
  };
}

function normalizeFault(rawFault: unknown, label: string): DeviceFault {
  assertObject(rawFault, label);

  if (typeof rawFault.id !== 'string' || rawFault.id.length === 0) {
    throw new Error(`${label} id is required`);
  }

  if (rawFault.type === 'offline') {
    return {
      id: rawFault.id,
      type: 'offline',
      enabled: rawFault.enabled !== false,
      exceptionCode:
        rawFault.exceptionCode == null
          ? undefined
          : assertPositiveInteger(rawFault.exceptionCode, `${label} exceptionCode`, {
              allowZero: true
            }),
      message:
        typeof rawFault.message === 'string' && rawFault.message.length > 0
          ? rawFault.message
          : undefined
    };
  }

  if (rawFault.type === 'freeze') {
    return {
      id: rawFault.id,
      type: 'freeze',
      enabled: rawFault.enabled !== false,
      message:
        typeof rawFault.message === 'string' && rawFault.message.length > 0
          ? rawFault.message
          : undefined
    };
  }

  if (rawFault.type === 'exception') {
    return {
      id: rawFault.id,
      type: 'exception',
      enabled: rawFault.enabled !== false,
      exceptionCode: assertPositiveInteger(rawFault.exceptionCode, `${label} exceptionCode`, {
        allowZero: true
      }),
      functionCodes: Array.isArray(rawFault.functionCodes)
        ? rawFault.functionCodes.map((value, index) =>
            assertPositiveInteger(value, `${label} functionCodes[${index}]`, {
              allowZero: true
            })
          )
        : undefined,
      bank:
        rawFault.bank == null
          ? undefined
          : normalizeBank(rawFault.bank, `${label} bank`, 'holding'),
      startAddress:
        rawFault.startAddress == null
          ? undefined
          : assertPositiveInteger(rawFault.startAddress, `${label} startAddress`, {
              allowZero: true
            }),
      endAddress:
        rawFault.endAddress == null
          ? undefined
          : assertPositiveInteger(rawFault.endAddress, `${label} endAddress`, {
              allowZero: true
            }),
      message:
        typeof rawFault.message === 'string' && rawFault.message.length > 0
          ? rawFault.message
          : undefined
    };
  }

  throw new Error(`${label} type must be offline, freeze, or exception`);
}

function normalizeScenarioPatch(rawPatch: unknown, label: string): DeviceScenarioPatch {
  assertObject(rawPatch, label);

  if (typeof rawPatch.deviceId !== 'string' || rawPatch.deviceId.length === 0) {
    throw new Error(`${label} deviceId is required`);
  }

  return {
    deviceId: rawPatch.deviceId,
    behaviorMode:
      rawPatch.behaviorMode == null
        ? undefined
        : normalizeBehaviorMode(rawPatch.behaviorMode, `${label} behaviorMode`),
    entryValues: Array.isArray(rawPatch.entryValues)
      ? rawPatch.entryValues.map((action, index) =>
          normalizeSetEntryAction(action, `${label} entryValues[${index}]`)
        )
      : undefined,
    rawWrites: Array.isArray(rawPatch.rawWrites)
      ? rawPatch.rawWrites.map((action, index) =>
          normalizeRawWriteAction(action, `${label} rawWrites[${index}]`)
        )
      : undefined,
    faults: Array.isArray(rawPatch.faults)
      ? rawPatch.faults.map((fault, index) => normalizeFault(fault, `${label} faults[${index}]`))
      : undefined,
    clearFaults: rawPatch.clearFaults === true
  };
}

function normalizeBehaviorMode(value: unknown, label: string): 'normal' | 'paused' {
  if (value === 'normal' || value === 'paused') {
    return value;
  }

  throw new Error(`${label} must be "normal" or "paused"`);
}

function normalizeScenario(rawScenario: unknown, index: number): ScenarioDefinition {
  assertObject(rawScenario, `Scenario[${index}]`);

  if (typeof rawScenario.id !== 'string' || rawScenario.id.length === 0) {
    throw new Error(`Scenario[${index}] id is required`);
  }

  if (!Array.isArray(rawScenario.patches) || rawScenario.patches.length === 0) {
    throw new Error(`Scenario[${index}] patches must be a non-empty array`);
  }

  return {
    id: rawScenario.id,
    name:
      typeof rawScenario.name === 'string' && rawScenario.name.length > 0
        ? rawScenario.name
        : undefined,
    description:
      typeof rawScenario.description === 'string' && rawScenario.description.length > 0
        ? rawScenario.description
        : undefined,
    patches: rawScenario.patches.map((patch, patchIndex) =>
      normalizeScenarioPatch(patch, `Scenario[${index}] patches[${patchIndex}]`)
    )
  };
}

function mergeDeviceInputs(
  baseDevice: Partial<DeviceConfigInput>,
  overrideDevice: Partial<DeviceConfigInput>
): Partial<DeviceConfigInput> {
  return {
    ...baseDevice,
    ...overrideDevice,
    registers: mergeRegisters(baseDevice.registers, overrideDevice.registers),
    behaviors: [...(baseDevice.behaviors ?? []), ...(overrideDevice.behaviors ?? [])]
  };
}

function resolveProfileDevice(rawDevice: UnknownRecord, index: number): Partial<DeviceConfigInput> {
  const profileId =
    typeof rawDevice.profile === 'string' && rawDevice.profile.length > 0
      ? rawDevice.profile
      : null;

  if (!profileId) {
    return rawDevice as unknown as Partial<DeviceConfigInput>;
  }

  const profile = getBuiltinProfile(profileId);
  if (!profile) {
    throw new Error(`Device[${index}] profile "${profileId}" is not available`);
  }

  return mergeDeviceInputs(
    {
      ...profile.device,
      profile: profile.id
    },
    rawDevice as unknown as Partial<DeviceConfigInput>
  );
}

function normalizeDevice(rawDevice: unknown, index: number): DeviceConfig {
  assertObject(rawDevice, `Device[${index}]`);

  const mergedDevice = resolveProfileDevice(rawDevice, index);

  if (!mergedDevice.id || typeof mergedDevice.id !== 'string') {
    throw new Error(`Device[${index}] id is required`);
  }

  return {
    id: mergedDevice.id,
    profileId: typeof mergedDevice.profile === 'string' ? mergedDevice.profile : null,
    profile: typeof mergedDevice.profile === 'string' ? mergedDevice.profile : undefined,
    name: normalizeString(mergedDevice.name, mergedDevice.id),
    kind: normalizeString(mergedDevice.kind, 'generic'),
    model: normalizeString(
      mergedDevice.model,
      normalizeString(mergedDevice.name, mergedDevice.id)
    ),
    transport: normalizeTransport(mergedDevice.transport, 'modbus-tcp'),
    host: normalizeString(mergedDevice.host, '0.0.0.0'),
    port: assertPositiveInteger(mergedDevice.port ?? 1502, `Device[${index}] port`, {
      allowZero: true
    }),
    unitId: assertPositiveInteger(mergedDevice.unitId ?? 1, `Device[${index}] unitId`, {
      allowZero: true
    }),
    registers: normalizeRegisters(mergedDevice.registers),
    behaviors: Array.isArray(mergedDevice.behaviors)
      ? mergedDevice.behaviors.map(normalizeBehavior)
      : []
  };
}

export function normalizeConfig(rawConfig: unknown): SimulatorConfig {
  assertObject(rawConfig, 'Config');

  if (!Array.isArray(rawConfig.devices) || rawConfig.devices.length === 0) {
    throw new Error('Config.devices must be a non-empty array');
  }

  const scenarios = Array.isArray(rawConfig.scenarios)
    ? rawConfig.scenarios.map((scenario, index) => normalizeScenario(scenario, index))
    : [];

  const activeScenarioId =
    typeof rawConfig.activeScenarioId === 'string' && rawConfig.activeScenarioId.length > 0
      ? rawConfig.activeScenarioId
      : null;

  if (activeScenarioId && !scenarios.some((scenario) => scenario.id === activeScenarioId)) {
    throw new Error(`activeScenarioId "${activeScenarioId}" is not defined in scenarios`);
  }

  return {
    behaviorTickMs:
      rawConfig.behaviorTickMs == null
        ? 2000
        : assertPositiveInteger(rawConfig.behaviorTickMs, 'behaviorTickMs'),
    controlApi: normalizeControlApi(rawConfig.controlApi),
    devices: rawConfig.devices.map((device, index) => normalizeDevice(device, index)),
    scenarios,
    activeScenarioId
  };
}

function validateActiveScenarioId(
  scenarios: ScenarioDefinition[],
  activeScenarioId: string | null
): void {
  if (activeScenarioId && !scenarios.some((scenario) => scenario.id === activeScenarioId)) {
    throw new Error(`activeScenarioId "${activeScenarioId}" is not defined in scenarios`);
  }
}

function normalizeSystemConfig(rawSystemConfig: unknown): Pick<SimulatorConfig, 'behaviorTickMs' | 'controlApi'> {
  if (rawSystemConfig == null) {
    return {
      behaviorTickMs: 2000,
      controlApi: normalizeControlApi(undefined)
    };
  }

  assertObject(rawSystemConfig, 'System config');

  return {
    behaviorTickMs:
      rawSystemConfig.behaviorTickMs == null
        ? 2000
        : assertPositiveInteger(rawSystemConfig.behaviorTickMs, 'behaviorTickMs'),
    controlApi: normalizeControlApi(rawSystemConfig.controlApi)
  };
}

function normalizeDeviceFile(
  rawDeviceConfig: unknown
): Pick<SimulatorConfig, 'devices' | 'scenarios' | 'activeScenarioId'> {
  assertObject(rawDeviceConfig, 'Device config');

  const rawDevices = rawDeviceConfig.device == null ? rawDeviceConfig.devices : [rawDeviceConfig.device];
  if (!Array.isArray(rawDevices) || rawDevices.length === 0) {
    throw new Error('Device config must define a non-empty "device" or "devices" section');
  }

  const scenarios = Array.isArray(rawDeviceConfig.scenarios)
    ? rawDeviceConfig.scenarios.map((scenario, index) => normalizeScenario(scenario, index))
    : [];

  const activeScenarioId =
    typeof rawDeviceConfig.activeScenarioId === 'string' &&
    rawDeviceConfig.activeScenarioId.length > 0
      ? rawDeviceConfig.activeScenarioId
      : null;

  validateActiveScenarioId(scenarios, activeScenarioId);

  return {
    devices: rawDevices.map((device, index) => normalizeDevice(device, index)),
    scenarios,
    activeScenarioId
  };
}

export async function loadConfig(
  deviceConfigPath: string,
  options: { systemConfigPath?: string } = {}
): Promise<SimulatorConfig> {
  const rawDeviceText = await readFile(deviceConfigPath, 'utf8');
  const rawDeviceConfig: unknown = JSON.parse(rawDeviceText);
  const rawSystemConfig: unknown = options.systemConfigPath
    ? JSON.parse(await readFile(options.systemConfigPath, 'utf8'))
    : {};

  return {
    ...normalizeSystemConfig(rawSystemConfig),
    ...normalizeDeviceFile(rawDeviceConfig)
  };
}
