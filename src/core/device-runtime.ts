import { RegisterBank } from './register-bank.ts';
import type {
  BehaviorMode,
  DeviceAction,
  DeviceBehavior,
  DeviceConfig,
  DeviceConfigInput,
  DeviceFault,
  DeviceTransport,
  DeviceRequestMeta,
  DeviceScenarioPatch,
  DeviceSnapshot,
  DeviceSummary,
  NormalizedRegisterEntry,
  RegisterBankName,
  SetEntryValueAction,
  ValueFromWrittenConfig
} from '../types.ts';

interface DeviceWriteOptions {
  force?: boolean;
  skipWriteTriggers?: boolean;
}

function applyDerivedValue(baseValue: number, config: ValueFromWrittenConfig | undefined): number {
  if (!config) {
    return baseValue;
  }

  let nextValue = baseValue;

  if (config.multiply != null) {
    nextValue *= config.multiply;
  }

  if (config.offset != null) {
    nextValue += config.offset;
  }

  if (config.min != null) {
    nextValue = Math.max(nextValue, config.min);
  }

  if (config.max != null) {
    nextValue = Math.min(nextValue, config.max);
  }

  if (config.round === 'round') {
    nextValue = Math.round(nextValue);
  } else if (config.round === 'floor') {
    nextValue = Math.floor(nextValue);
  } else if (config.round === 'ceil') {
    nextValue = Math.ceil(nextValue);
  }

  return nextValue;
}

function actionToValue(action: SetEntryValueAction, writtenValue: number): number {
  if (action.value != null) {
    return action.value;
  }

  if (action.fromWritten) {
    return applyDerivedValue(writtenValue, action.fromWritten);
  }

  throw new Error(
    `setEntryValue action for ${action.bank}:${action.address} requires value or fromWritten`
  );
}

function requestIntersectsRange(
  startAddress: number | undefined,
  quantity: number | undefined,
  faultStartAddress: number | undefined,
  faultEndAddress: number | undefined
): boolean {
  if (faultStartAddress == null && faultEndAddress == null) {
    return true;
  }

  if (startAddress == null) {
    return false;
  }

  const requestStart = startAddress;
  const requestEnd = startAddress + Math.max((quantity ?? 1) - 1, 0);
  const faultStart = faultStartAddress ?? faultEndAddress ?? requestStart;
  const faultEnd = faultEndAddress ?? faultStartAddress ?? requestEnd;

  return requestStart <= faultEnd && requestEnd >= faultStart;
}

export class DeviceRuntime {
  id: string;

  profileId: string | null;

  name: string;

  kind: string;

  model: string;

  transport: DeviceTransport;

  host: string;

  port: number;

  listenPort: number;

  unitId: number;

  behaviors: DeviceBehavior[];

  registerBank: RegisterBank;

  behaviorMode: BehaviorMode;

  currentScenario: string | null;

  private baseRegisters: DeviceConfig['registers'];

  private activeFaults: Map<string, DeviceFault>;

  private isApplyingWriteTriggers: boolean;

  constructor(config: DeviceConfigInput | DeviceConfig) {
    if (!config.id) {
      throw new Error('Device id is required');
    }

    this.id = config.id;
    this.profileId = 'profileId' in config ? config.profileId : config.profile ?? null;
    this.name = config.name ?? config.id;
    this.kind = config.kind ?? 'generic';
    this.model = config.model ?? this.name;
    this.transport = config.transport ?? 'modbus-tcp';
    this.host = config.host ?? '0.0.0.0';
    this.port = config.port ?? 1502;
    this.listenPort = this.port;
    this.unitId = config.unitId ?? 1;
    this.behaviors = structuredClone(config.behaviors ?? []);
    this.baseRegisters = structuredClone(config.registers ?? {});
    this.registerBank = new RegisterBank(structuredClone(this.baseRegisters));
    this.behaviorMode = 'normal';
    this.currentScenario = null;
    this.activeFaults = new Map<string, DeviceFault>();
    this.isApplyingWriteTriggers = false;
  }

  setListenPort(port: number): void {
    this.listenPort = port;
  }

  getTimedBehaviors() {
    return this.behaviors.filter(
      (behavior): behavior is Extract<DeviceBehavior, { type: 'randomWalk' | 'sineWave' }> =>
        behavior.type === 'randomWalk' || behavior.type === 'sineWave'
    );
  }

  private getWriteTriggerBehaviors() {
    return this.behaviors.filter(
      (behavior): behavior is Extract<DeviceBehavior, { type: 'onWriteTrigger' }> =>
        behavior.type === 'onWriteTrigger'
    );
  }

  shouldRunBehaviors(): boolean {
    return this.behaviorMode === 'normal' && !this.hasFaultType('freeze');
  }

  readHolding(startAddress: number, quantity: number): number[] {
    return this.registerBank.readRange('holding', startAddress, quantity);
  }

  readInput(startAddress: number, quantity: number): number[] {
    return this.registerBank.readRange('input', startAddress, quantity);
  }

  writeHolding(startAddress: number, values: number[], options: DeviceWriteOptions = {}): void {
    this.setRawRegisters('holding', startAddress, values, options);
  }

  setRawRegisters(
    bank: RegisterBankName,
    startAddress: number,
    values: number[],
    options: DeviceWriteOptions = {}
  ): void {
    this.registerBank.setRawRegisters(bank, startAddress, values, {
      force: options.force
    });

    if (!options.skipWriteTriggers) {
      this.runOnWriteTriggers(bank, startAddress, values.length);
    }
  }

  getEntry(bank: RegisterBankName, address: number): NormalizedRegisterEntry | null {
    return this.registerBank.getEntry(bank, address);
  }

  getEntryValue(bank: RegisterBankName, address: number): number {
    return this.registerBank.getEntryValue(bank, address);
  }

  setEntryValue(
    bank: RegisterBankName,
    address: number,
    value: number,
    options: DeviceWriteOptions = {}
  ): void {
    const entry = this.registerBank.getEntry(bank, address);
    if (!entry) {
      throw new Error(`Unknown ${bank} entry at address ${address}`);
    }

    this.registerBank.setEntryValue(bank, address, value, {
      force: options.force
    });

    if (!options.skipWriteTriggers) {
      this.runOnWriteTriggers(bank, entry.address, entry.length);
    }
  }

  private runOnWriteTriggers(
    bank: RegisterBankName,
    startAddress: number,
    quantity: number
  ): void {
    if (this.isApplyingWriteTriggers) {
      return;
    }

    const touchedEntries = this.registerBank.findTouchedEntries(bank, startAddress, quantity);
    if (touchedEntries.length === 0) {
      return;
    }

    this.isApplyingWriteTriggers = true;

    try {
      for (const touchedEntry of touchedEntries) {
        const writtenValue = this.getEntryValue(touchedEntry.bank, touchedEntry.address);

        for (const trigger of this.getWriteTriggerBehaviors()) {
          const triggerBank = trigger.bank ?? 'holding';
          if (triggerBank !== touchedEntry.bank || trigger.address !== touchedEntry.address) {
            continue;
          }

          for (const action of trigger.actions) {
            this.applyAction(action, writtenValue);
          }
        }
      }
    } finally {
      this.isApplyingWriteTriggers = false;
    }
  }

  private applyAction(action: DeviceAction, writtenValue: number): void {
    if (action.kind === 'setEntryValue') {
      this.setEntryValue(action.bank, action.address, actionToValue(action, writtenValue), {
        force: action.force,
        skipWriteTriggers: true
      });
      return;
    }

    this.setRawRegisters(action.bank, action.address, action.values, {
      force: action.force,
      skipWriteTriggers: true
    });
  }

  applyFault(fault: DeviceFault): void {
    if (fault.enabled === false) {
      return;
    }

    this.activeFaults.set(fault.id, structuredClone(fault));
  }

  clearFaults(ids?: string[]): void {
    if (!ids || ids.length === 0) {
      this.activeFaults.clear();
      return;
    }

    for (const id of ids) {
      this.activeFaults.delete(id);
    }
  }

  listFaults(): DeviceFault[] {
    return [...this.activeFaults.values()].map((fault) => structuredClone(fault));
  }

  hasFaultType(type: DeviceFault['type']): boolean {
    return [...this.activeFaults.values()].some((fault) => fault.type === type);
  }

  evaluateFault(meta: DeviceRequestMeta): number | null {
    for (const fault of this.activeFaults.values()) {
      if (fault.enabled === false) {
        continue;
      }

      if (fault.type === 'offline') {
        return fault.exceptionCode ?? 0x04;
      }

      if (fault.type !== 'exception') {
        continue;
      }

      if (fault.functionCodes && !fault.functionCodes.includes(meta.functionCode)) {
        continue;
      }

      if (fault.bank && meta.bank && fault.bank !== meta.bank) {
        continue;
      }

      if (
        !requestIntersectsRange(meta.startAddress, meta.quantity, fault.startAddress, fault.endAddress)
      ) {
        continue;
      }

      return fault.exceptionCode;
    }

    return null;
  }

  resetRuntimeState(): void {
    this.registerBank = new RegisterBank(structuredClone(this.baseRegisters));
    this.clearFaults();
    this.behaviorMode = 'normal';
    this.currentScenario = null;
    this.isApplyingWriteTriggers = false;
  }

  applyScenarioPatch(scenarioId: string, patch: DeviceScenarioPatch): void {
    if (patch.clearFaults) {
      this.clearFaults();
    }

    if (patch.behaviorMode) {
      this.behaviorMode = patch.behaviorMode;
    }

    patch.entryValues?.forEach((action) => {
      this.applyAction(action, 0);
    });

    patch.rawWrites?.forEach((action) => {
      this.applyAction(action, 0);
    });

    patch.faults?.forEach((fault) => {
      this.applyFault(fault);
    });

    this.currentScenario = scenarioId;
  }

  setCurrentScenario(scenarioId: string | null): void {
    this.currentScenario = scenarioId;
  }

  getSummary(): DeviceSummary {
    return {
      id: this.id,
      profileId: this.profileId,
      name: this.name,
      kind: this.kind,
      model: this.model,
      transport: this.transport,
      host: this.host,
      port: this.listenPort,
      configuredPort: this.port,
      unitId: this.unitId,
      behaviorCount: this.behaviors.length,
      behaviorMode: this.behaviorMode,
      activeFaultCount: this.activeFaults.size,
      currentScenario: this.currentScenario
    };
  }

  getSnapshot(): DeviceSnapshot {
    return {
      ...this.getSummary(),
      registers: {
        holding: this.registerBank.listEntries('holding'),
        input: this.registerBank.listEntries('input')
      },
      raw: {
        holding: this.registerBank.dumpRaw('holding'),
        input: this.registerBank.dumpRaw('input')
      },
      faults: this.listFaults()
    };
  }
}
