import {
  loadPersistedProfileId,
  savePersistedProfileId
} from './profile-selection-store.ts';
import { BehaviorEngine } from '../core/behavior-engine.ts';
import { DeviceRuntime } from '../core/device-runtime.ts';
import { ControlServer } from '../http/control-server.ts';
import { ShellyGen1HttpServer } from '../http/shelly-server.ts';
import { ModbusTcpServer } from '../modbus/server.ts';
import { getBuiltinProfile, listBuiltinProfiles } from '../profiles/builtin.ts';
import { buildProtocolPreview } from '../protocols/output-preview.ts';
import type { AddressInfo } from 'node:net';
import type {
  DashboardPayload,
  DeviceConfig,
  DeviceFault,
  DeviceSummary,
  ScenarioDefinition,
  ScenarioSummary,
  SimulatorConfig,
  TrafficLogEntry
} from '../types.ts';

interface DeviceListenerGroup {
  host: string;
  port: number;
  devices: DeviceRuntime[];
}

interface ShellyListener {
  device: DeviceRuntime;
  server: ShellyGen1HttpServer;
}

interface SwitchDeviceOptions {
  profileId: string;
  host?: string;
  port?: number;
  unitId?: number;
}

interface BuiltinDeviceSelectionOptions {
  profileId: string;
  deviceId?: string;
  host?: string;
  port?: number;
  unitId?: number;
}

interface SimulatorAppOptions {
  stateFilePath?: string | null;
}

export class SimulatorApp {
  static readonly MAX_TRAFFIC_LOG_ENTRIES = 100;

  config: SimulatorConfig;

  devices: Map<string, DeviceRuntime>;

  modbusServers: ModbusTcpServer[];

  shellyServers: ShellyListener[];

  controlServer: ControlServer | null;

  behaviorEngine: BehaviorEngine;

  scenarios: Map<string, ScenarioDefinition>;

  activeScenarioId: string | null;

  trafficLog: TrafficLogEntry[];

  nextTrafficId: number;

  stateFilePath: string | null;

  constructor(config: SimulatorConfig, options: SimulatorAppOptions = {}) {
    this.stateFilePath = options.stateFilePath ?? null;
    this.config = this.applyPersistedStartupState(config);
    this.devices = new Map<string, DeviceRuntime>();
    this.modbusServers = [];
    this.shellyServers = [];
    this.controlServer = null;
    this.scenarios = new Map<string, ScenarioDefinition>(
      this.config.scenarios.map((scenario) => [scenario.id, scenario])
    );
    this.activeScenarioId = null;
    this.trafficLog = [];
    this.nextTrafficId = 1;
    this.devices = this.buildDeviceMap(this.config.devices);
    this.behaviorEngine = this.createBehaviorEngine(this.devices);

    if (this.config.activeScenarioId) {
      this.applyScenario(this.config.activeScenarioId);
    }
  }

  static fromConfig(config: SimulatorConfig, options: SimulatorAppOptions = {}): SimulatorApp {
    return new SimulatorApp(config, options);
  }

  private buildDeviceMap(deviceConfigs: DeviceConfig[]): Map<string, DeviceRuntime> {
    const devices = new Map<string, DeviceRuntime>();

    for (const deviceConfig of deviceConfigs) {
      if (devices.has(deviceConfig.id)) {
        throw new Error(`Duplicate device id "${deviceConfig.id}"`);
      }
      devices.set(deviceConfig.id, new DeviceRuntime(deviceConfig));
    }

    return devices;
  }

  private createBehaviorEngine(devices: Map<string, DeviceRuntime>): BehaviorEngine {
    return new BehaviorEngine([...devices.values()], {
      tickMs: this.config.behaviorTickMs
    });
  }

  private buildBuiltinDeviceConfig(
    options: BuiltinDeviceSelectionOptions,
    fallbackDevice: DeviceConfig
  ): DeviceConfig | null {
    const profile = getBuiltinProfile(options.profileId);
    if (!profile) {
      return null;
    }

    return {
      id: options.deviceId || `${profile.id}-1`,
      profileId: profile.id,
      profile: profile.id,
      name: profile.title,
      kind: profile.device.kind ?? fallbackDevice.kind ?? 'generic',
      model: profile.device.model ?? profile.title,
      transport: profile.transport,
      host: options.host ?? fallbackDevice.host ?? '0.0.0.0',
      port: options.port ?? profile.device.port ?? profile.defaultPort,
      unitId: options.unitId ?? profile.device.unitId ?? fallbackDevice.unitId ?? 1,
      registers: structuredClone(profile.device.registers ?? {}),
      behaviors: structuredClone(profile.device.behaviors ?? [])
    };
  }

  private applyPersistedStartupState(config: SimulatorConfig): SimulatorConfig {
    if (config.devices.length !== 1) {
      return config;
    }

    const profileId = loadPersistedProfileId(this.stateFilePath);
    if (!profileId) {
      return config;
    }

    const restoredDevice = this.buildBuiltinDeviceConfig({ profileId }, config.devices[0]!);
    if (!restoredDevice) {
      return config;
    }

    return {
      ...config,
      devices: [restoredDevice],
      scenarios: [],
      activeScenarioId: null
    };
  }

  private async persistCurrentSelection(): Promise<void> {
    const summary = this.getPrimaryDeviceSummary();
    if (!summary || !summary.profileId) {
      return;
    }

    await savePersistedProfileId(this.stateFilePath, summary.profileId);
  }

  private buildListenerGroups(devices: Iterable<DeviceRuntime>): Map<string, DeviceListenerGroup> {
    const groups = new Map<string, DeviceListenerGroup>();

    for (const device of devices) {
      if (device.transport !== 'modbus-tcp') {
        continue;
      }

      const key = `${device.host}:${device.port}`;
      const group = groups.get(key) ?? {
        host: device.host,
        port: device.port,
        devices: []
      };

      if (group.devices.some((item) => item.unitId === device.unitId)) {
        throw new Error(`Duplicate unitId ${device.unitId} on listener ${device.host}:${device.port}`);
      }

      group.devices.push(device);
      groups.set(key, group);
    }

    return groups;
  }

  private async startModbusServers(devices: Map<string, DeviceRuntime>): Promise<ModbusTcpServer[]> {
    const servers: ModbusTcpServer[] = [];

    for (const group of this.buildListenerGroups(devices.values()).values()) {
      const server = new ModbusTcpServer(group);
      server.onTraffic = (entry) => {
        this.recordTraffic(entry);
      };
      await server.start();
      servers.push(server);

      const address = server.address;
      if (!address) {
        throw new Error(`Failed to resolve listening address for ${group.host}:${group.port}`);
      }

      for (const device of group.devices) {
        device.setListenPort(address.port);
      }
    }

    return servers;
  }

  private async stopModbusServers(): Promise<void> {
    await Promise.all(this.modbusServers.map((server) => server.stop()));
    this.modbusServers = [];
  }

  private async startShellyServers(devices: Map<string, DeviceRuntime>): Promise<ShellyListener[]> {
    const listeners: ShellyListener[] = [];

    for (const device of devices.values()) {
      if (device.transport !== 'shelly-gen1-http') {
        continue;
      }

      const server = new ShellyGen1HttpServer({
        device,
        host: device.host,
        port: device.port
      });
      server.onTraffic = (entry) => {
        this.recordTraffic(entry);
      };
      await server.start();

      const address = server.address;
      if (!address) {
        throw new Error(`Failed to resolve Shelly listener for ${device.host}:${device.port}`);
      }

      device.setListenPort(address.port);
      listeners.push({ device, server });
    }

    return listeners;
  }

  private async stopShellyServers(): Promise<void> {
    await Promise.all(this.shellyServers.map((listener) => listener.server.stop()));
    this.shellyServers = [];
  }

  getDevice(id: string): DeviceRuntime | null {
    return this.devices.get(id) ?? null;
  }

  listDevices(): DeviceSummary[] {
    return [...this.devices.values()].map((device) => device.getSummary());
  }

  listProfiles() {
    return listBuiltinProfiles();
  }

  getPrimaryDeviceSummary(): DeviceSummary | null {
    return this.listDevices()[0] ?? null;
  }

  getPrimaryDeviceSnapshot() {
    const device = [...this.devices.values()][0];
    return device?.getSnapshot() ?? null;
  }

  getPrimaryProfile() {
    const profileId = this.getPrimaryDeviceSummary()?.profileId;
    if (!profileId) {
      return null;
    }

    return this.listProfiles().find((profile) => profile.id === profileId) ?? null;
  }

  listScenarios(): ScenarioSummary[] {
    return [...this.scenarios.values()].map((scenario) => ({
      id: scenario.id,
      name: scenario.name ?? scenario.id,
      description: scenario.description ?? null,
      patchCount: scenario.patches.length
    }));
  }

  getActiveScenarioId(): string | null {
    return this.activeScenarioId;
  }

  getControlApiAddress(): AddressInfo | null {
    return this.controlServer?.address ?? null;
  }

  recordTraffic(
    entry: Omit<TrafficLogEntry, 'id' | 'timestamp'>
  ): void {
    const enriched: TrafficLogEntry = {
      id: this.nextTrafficId,
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.nextTrafficId += 1;
    this.trafficLog.unshift(enriched);
    if (this.trafficLog.length > SimulatorApp.MAX_TRAFFIC_LOG_ENTRIES) {
      this.trafficLog.length = SimulatorApp.MAX_TRAFFIC_LOG_ENTRIES;
    }

    this.printTraffic(enriched);
  }

  listTraffic(): TrafficLogEntry[] {
    return this.trafficLog.map((entry) => ({ ...entry }));
  }

  getDashboard(): DashboardPayload {
    const device = this.getPrimaryDeviceSummary();
    const snapshot = this.getPrimaryDeviceSnapshot();
    const profile = this.getPrimaryProfile();
    const runtime = device ? this.getDevice(device.id) : null;

    return {
      health: {
        status: 'ok',
        devices: this.listDevices().length,
        activeScenarioId: this.getActiveScenarioId()
      },
      device,
      snapshot,
      profile,
      protocolPreview: buildProtocolPreview(runtime, profile),
      profiles: this.listProfiles(),
      scenarios: this.listScenarios(),
      traffic: this.listTraffic()
    };
  }

  async switchDeviceProfile(options: SwitchDeviceOptions): Promise<DeviceSummary> {
    const fallbackDevice = this.config.devices[0];
    if (!fallbackDevice) {
      throw new Error('No base device available for profile switching');
    }

    const nextDeviceConfig = this.buildBuiltinDeviceConfig(
      {
        deviceId: `${options.profileId}-1`,
        profileId: options.profileId,
        host: options.host,
        port: options.port,
        unitId: options.unitId
      },
      fallbackDevice
    );
    if (!nextDeviceConfig) {
      throw new Error(`Unknown profile "${options.profileId}"`);
    }

    const previousDevices = this.devices;
    const previousServers = this.modbusServers;
    const previousShellyServers = this.shellyServers;
    const previousBehaviorEngine = this.behaviorEngine;
    const previousScenarios = this.scenarios;
    const previousActiveScenarioId = this.activeScenarioId;
    const previousConfig = this.config;
    const nextConfig: SimulatorConfig = {
      ...this.config,
      devices: [nextDeviceConfig],
      scenarios: [],
      activeScenarioId: null
    };

    const nextDevices = this.buildDeviceMap([nextDeviceConfig]);
    const nextBehaviorEngine = this.createBehaviorEngine(nextDevices);

    previousBehaviorEngine.stop();
    await this.stopShellyServers();
    await this.stopModbusServers();

    this.devices = nextDevices;
    this.behaviorEngine = nextBehaviorEngine;
    this.scenarios = new Map<string, ScenarioDefinition>();
    this.activeScenarioId = null;
    this.trafficLog = [];
    this.config = nextConfig;

    try {
      this.modbusServers = await this.startModbusServers(this.devices);
      this.shellyServers = await this.startShellyServers(this.devices);
      this.behaviorEngine.start();
      const summary = this.getPrimaryDeviceSummary();
      if (!summary) {
        throw new Error('No device available after switch');
      }
      await this.persistCurrentSelection();
      return summary;
    } catch (error) {
      this.devices = previousDevices;
      this.behaviorEngine = previousBehaviorEngine;
      this.scenarios = previousScenarios;
      this.activeScenarioId = previousActiveScenarioId;
      this.modbusServers = previousServers;
      this.shellyServers = previousShellyServers;
      this.trafficLog = [];
      this.config = previousConfig;

      this.modbusServers = await this.startModbusServers(this.devices);
      this.shellyServers = await this.startShellyServers(this.devices);
      this.behaviorEngine.start();
      throw error;
    }
  }

  applyScenario(scenarioId: string): void {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Unknown scenario "${scenarioId}"`);
    }

    for (const device of this.devices.values()) {
      device.resetRuntimeState();
      device.setCurrentScenario(scenarioId);
    }

    for (const patch of scenario.patches) {
      const device = this.devices.get(patch.deviceId);
      if (!device) {
        throw new Error(`Scenario "${scenarioId}" references unknown device "${patch.deviceId}"`);
      }
      device.applyScenarioPatch(scenarioId, patch);
    }

    this.activeScenarioId = scenarioId;
  }

  clearScenario(): void {
    for (const device of this.devices.values()) {
      device.resetRuntimeState();
    }

    this.activeScenarioId = null;
  }

  resetDevice(deviceId: string): void {
    const device = this.getDevice(deviceId);
    if (!device) {
      throw new Error(`Unknown device "${deviceId}"`);
    }

    device.resetRuntimeState();
    if (this.activeScenarioId) {
      const scenario = this.scenarios.get(this.activeScenarioId);
      scenario?.patches
        .filter((patch) => patch.deviceId === deviceId)
        .forEach((patch) => {
          device.setCurrentScenario(this.activeScenarioId);
          device.applyScenarioPatch(this.activeScenarioId!, patch);
        });
    }
  }

  applyDeviceFault(deviceId: string, fault: DeviceFault): void {
    const device = this.getDevice(deviceId);
    if (!device) {
      throw new Error(`Unknown device "${deviceId}"`);
    }

    device.applyFault(fault);
  }

  clearDeviceFaults(deviceId: string, ids?: string[]): void {
    const device = this.getDevice(deviceId);
    if (!device) {
      throw new Error(`Unknown device "${deviceId}"`);
    }

    device.clearFaults(ids);
  }

  private printTraffic(entry: TrafficLogEntry): void {
    const prefix = `[${entry.protocol}]`;
    if (entry.protocol === 'http') {
      console.log(
        `${prefix} ${entry.outcome.toUpperCase()} ${entry.method ?? 'HTTP'} ${entry.requestTarget ?? '/'}`
        + `${entry.message ? ` - ${entry.message}` : ''}`
      );
      return;
    }

    const action = entry.functionCode == null ? 'fc--' : `fc${entry.functionCode.toString(16).padStart(2, '0')}`;
    const range =
      entry.startAddress == null
        ? '-'
        : `${entry.bank ?? '-'} ${entry.startAddress}${entry.quantity != null ? ` +${entry.quantity}` : ''}`;
    console.log(
      `${prefix} ${entry.outcome.toUpperCase()} ${action} unit=${entry.unitId} ${range}`
      + `${entry.message ? ` - ${entry.message}` : ''}`
    );
  }

  async start(): Promise<void> {
    this.modbusServers = await this.startModbusServers(this.devices);
    this.shellyServers = await this.startShellyServers(this.devices);

    if (this.config.controlApi.enabled) {
      this.controlServer = new ControlServer({
        app: this,
        host: this.config.controlApi.host,
        port: this.config.controlApi.port
      });
      await this.controlServer.start();
    }

    this.behaviorEngine.start();
    await this.persistCurrentSelection();
  }

  async stop(): Promise<void> {
    this.behaviorEngine.stop();

    if (this.controlServer) {
      await this.controlServer.stop();
      this.controlServer = null;
    }

    await this.stopShellyServers();
    await this.stopModbusServers();
  }
}
