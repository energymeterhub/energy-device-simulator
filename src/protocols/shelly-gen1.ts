import type { DeviceRuntime } from '../core/device-runtime.ts';

export interface ShellyEmeterReading {
  power: number;
  pf: number;
  current: number;
  voltage: number;
  is_valid: boolean;
  total: number;
  total_returned: number;
}

export const PHASE_INDEXES = [0, 1, 2] as const;
export const EMETER_REGISTER_BASES = [0, 20, 40] as const;
export const RELAY_REGISTER_ADDRESS = 100;

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function deriveDeviceToken(deviceId: string): string {
  const source = deviceId.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SHEM3SIM';
  return source.padEnd(12, '0').slice(0, 12);
}

export function getPhaseLabel(index: number): string {
  return ['Phase A', 'Phase B', 'Phase C'][index] ?? `Phase ${index + 1}`;
}

export function buildShellyDeviceMac(device: DeviceRuntime): string {
  const token = deriveDeviceToken(device.id);
  return token.match(/.{1,2}/g)?.join(':') ?? 'AA:BB:CC:DD:EE:FF';
}

export function buildShellyHostname(device: DeviceRuntime): string {
  return `shellyem3-${deriveDeviceToken(device.id).toLowerCase()}`;
}

export function buildShellyRelayPayload(device: DeviceRuntime) {
  return {
    ison: device.getEntryValue('holding', RELAY_REGISTER_ADDRESS) !== 0,
    has_timer: false,
    timer_started: 0,
    timer_duration: 0,
    timer_remaining: 0,
    overpower: false,
    is_valid: true,
    source: 'http'
  };
}

export function buildShellySettingsRelayPayload(device: DeviceRuntime) {
  return {
    name: 'Main Contactor',
    ison: buildShellyRelayPayload(device).ison,
    has_timer: false,
    default_state: 'off',
    auto_on: 0,
    auto_off: 0,
    schedule: false,
    schedule_rules: [],
    max_power: 0
  };
}

export function buildShellyEmeterReading(device: DeviceRuntime, index: number): ShellyEmeterReading {
  const base = EMETER_REGISTER_BASES[index];
  if (base == null) {
    throw new Error(`Unknown emeter index ${index}`);
  }

  const power = device.getEntryValue('input', base);
  const pf = device.getEntryValue('input', base + 2);
  const voltage = device.getEntryValue('input', base + 4);
  const total = device.getEntryValue('input', base + 6);
  const totalReturned = device.getEntryValue('input', base + 8);
  const safePf = Math.abs(pf) < 0.001 ? 1 : Math.abs(pf);
  const current = voltage > 0 ? Math.abs(power) / (voltage * safePf) : 0;

  return {
    power: round(power, 2),
    pf: round(pf, 3),
    current: round(current, 3),
    voltage: round(voltage, 1),
    is_valid: true,
    total: round(total, 2),
    total_returned: round(totalReturned, 2)
  };
}

export function buildShellySettingsEmeterPayload(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 2) {
    throw new Error(`Unknown emeter index ${index}`);
  }

  return {
    name: getPhaseLabel(index),
    appliance_type: 'General',
    max_power: 0
  };
}

export function buildShellyStatusPayload(device: DeviceRuntime) {
  const emeters = PHASE_INDEXES.map((index) => buildShellyEmeterReading(device, index));
  const totalPower = emeters.reduce((sum, item) => sum + item.power, 0);

  return {
    wifi_sta: {
      connected: true,
      ssid: 'simulator-lan',
      ip: '192.168.1.80',
      rssi: -51
    },
    cloud: {
      enabled: false,
      connected: false
    },
    mqtt: {
      connected: false
    },
    time: new Date().toTimeString().slice(0, 8),
    unixtime: Math.floor(Date.now() / 1000),
    serial: 1,
    has_update: false,
    mac: buildShellyDeviceMac(device),
    relays: [buildShellyRelayPayload(device)],
    emeters,
    total_power: round(totalPower, 2),
    fs_mounted: true,
    uptime: Math.floor(process.uptime())
  };
}

export function buildShellySettingsPayload(device: DeviceRuntime) {
  return {
    device: {
      type: 'SHEM-3',
      mac: buildShellyDeviceMac(device),
      hostname: buildShellyHostname(device),
      num_outputs: 1,
      num_emeters: 3
    },
    login: {
      enabled: false,
      unprotected: true,
      username: 'admin'
    },
    fw: '20230913-114005/v1.14.0-gcb84623',
    discoverable: true,
    relays: [buildShellySettingsRelayPayload(device)],
    emeters: PHASE_INDEXES.map((index) => buildShellySettingsEmeterPayload(index)),
    led_status_disable: false,
    wifi_ap: {
      enabled: false,
      ssid: buildShellyHostname(device),
      key: ''
    },
    wifi_sta: {
      enabled: true,
      ssid: 'simulator-lan',
      ipv4_method: 'dhcp'
    },
    cloud: {
      enabled: false
    },
    mqtt: {
      enable: false
    },
    coiot: {
      enabled: true,
      update_period: 15
    }
  };
}

export function buildShellyIdentityPayload(device: DeviceRuntime) {
  return {
    type: 'SHEM-3',
    mac: buildShellyDeviceMac(device),
    auth: false,
    fw: '20230913-114005/v1.14.0-gcb84623',
    discoverable: true,
    longid: 1,
    num_outputs: 1,
    num_meters: 3,
    hostname: buildShellyHostname(device)
  };
}

export function resetShellyEnergyTotals(device: DeviceRuntime, indexes: readonly number[] = PHASE_INDEXES): void {
  for (const index of indexes) {
    const base = EMETER_REGISTER_BASES[index];
    if (base == null) {
      continue;
    }

    device.setEntryValue('input', base + 6, 0, { force: true });
    device.setEntryValue('input', base + 8, 0, { force: true });
  }
}
