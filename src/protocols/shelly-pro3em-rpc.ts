import type { DeviceRuntime } from '../core/device-runtime.ts';

const PHASE_LAYOUT = [
  {
    voltageAddress: 4,
    powerFactorAddress: 2,
    powerAddress: 0,
    forwardEnergyAddress: 6,
    reverseEnergyAddress: 8,
    voltageKey: 'a_voltage',
    currentKey: 'a_current',
    powerKey: 'a_act_power',
    forwardEnergyKey: 'a_total_act_energy',
    reverseEnergyKey: 'a_total_act_ret_energy'
  },
  {
    voltageAddress: 24,
    powerFactorAddress: 22,
    powerAddress: 20,
    forwardEnergyAddress: 26,
    reverseEnergyAddress: 28,
    voltageKey: 'b_voltage',
    currentKey: 'b_current',
    powerKey: 'b_act_power',
    forwardEnergyKey: 'b_total_act_energy',
    reverseEnergyKey: 'b_total_act_ret_energy'
  },
  {
    voltageAddress: 44,
    powerFactorAddress: 42,
    powerAddress: 40,
    forwardEnergyAddress: 46,
    reverseEnergyAddress: 48,
    voltageKey: 'c_voltage',
    currentKey: 'c_current',
    powerKey: 'c_active_power',
    forwardEnergyKey: 'c_total_act_energy',
    reverseEnergyKey: 'c_total_act_ret_energy'
  }
] as const;

interface ShellyPhaseSnapshot {
  voltage: number;
  current: number;
  activePower: number;
  forwardEnergyWh: number;
  reverseEnergyWh: number;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function derivePhaseSnapshot(
  device: DeviceRuntime,
  phase: (typeof PHASE_LAYOUT)[number]
): ShellyPhaseSnapshot {
  const voltage = device.getEntryValue('input', phase.voltageAddress);
  const activePower = device.getEntryValue('input', phase.powerAddress);
  const powerFactor = device.getEntryValue('input', phase.powerFactorAddress);
  const safePowerFactor = Math.abs(powerFactor) >= 0.01 ? Math.abs(powerFactor) : 1;
  const current = voltage > 0 ? Math.abs(activePower) / (voltage * safePowerFactor) : 0;

  return {
    voltage: round(voltage, 1),
    current: round(current, 3),
    activePower: round(activePower, 2),
    forwardEnergyWh: round(device.getEntryValue('input', phase.forwardEnergyAddress), 3),
    reverseEnergyWh: round(device.getEntryValue('input', phase.reverseEnergyAddress), 3)
  };
}

export function buildShellyPro3emRpcEmStatus(device: DeviceRuntime) {
  const phases = PHASE_LAYOUT.map((phase) => derivePhaseSnapshot(device, phase));
  const totalCurrent = phases.reduce((sum, phase) => sum + phase.current, 0);
  const totalActivePower = phases.reduce((sum, phase) => sum + phase.activePower, 0);

  return {
    id: 0,
    a_voltage: phases[0]?.voltage ?? 0,
    b_voltage: phases[1]?.voltage ?? 0,
    c_voltage: phases[2]?.voltage ?? 0,
    a_current: phases[0]?.current ?? 0,
    b_current: phases[1]?.current ?? 0,
    c_current: phases[2]?.current ?? 0,
    n_current: 0,
    total_current: round(totalCurrent, 3),
    a_act_power: phases[0]?.activePower ?? 0,
    b_act_power: phases[1]?.activePower ?? 0,
    c_active_power: phases[2]?.activePower ?? 0,
    total_act_power: round(totalActivePower, 2)
  };
}

export function buildShellyPro3emRpcEmDataStatus(device: DeviceRuntime) {
  const phases = PHASE_LAYOUT.map((phase) => derivePhaseSnapshot(device, phase));
  const totalForwardEnergyWh = phases.reduce((sum, phase) => sum + phase.forwardEnergyWh, 0);
  const totalReverseEnergyWh = phases.reduce((sum, phase) => sum + phase.reverseEnergyWh, 0);

  return {
    id: 0,
    a_total_act_energy: phases[0]?.forwardEnergyWh ?? 0,
    b_total_act_energy: phases[1]?.forwardEnergyWh ?? 0,
    c_total_act_energy: phases[2]?.forwardEnergyWh ?? 0,
    total_act: round(totalForwardEnergyWh, 3),
    a_total_act_ret_energy: phases[0]?.reverseEnergyWh ?? 0,
    b_total_act_ret_energy: phases[1]?.reverseEnergyWh ?? 0,
    c_total_act_ret_energy: phases[2]?.reverseEnergyWh ?? 0,
    total_act_ret: round(totalReverseEnergyWh, 3)
  };
}

export function buildShellyRpcEndpointSummary(device: DeviceRuntime) {
  const emStatus = buildShellyPro3emRpcEmStatus(device);
  const emDataStatus = buildShellyPro3emRpcEmDataStatus(device);

  return PHASE_LAYOUT.map((phase, index) => ({
    phase: index,
    voltage: emStatus[phase.voltageKey],
    current: emStatus[phase.currentKey],
    activePower: emStatus[phase.powerKey],
    forwardEnergyWh: emDataStatus[phase.forwardEnergyKey],
    reverseEnergyWh: emDataStatus[phase.reverseEnergyKey]
  }));
}
