import { ModbusTcpClient } from '../modbus/client.ts';
import type { RegisterBankName, RegisterType } from '../types.ts';

export interface MeterPointDefinition {
  key: string;
  label: string;
  unit?: string;
  bank: RegisterBankName;
  address: number;
  type: RegisterType;
  order?: string;
  scale?: number;
  scaleKey?: string;
}

export interface MeterPointReading extends MeterPointDefinition {
  value: number;
  rawValue: number;
}

export interface MeterReading {
  profileId: string;
  collectedAt: string;
  points: MeterPointReading[];
  values: Record<string, number>;
  rawValues: Record<string, number>;
}

type MeterScalePointDefinition = Pick<
  MeterPointDefinition,
  'key' | 'bank' | 'address' | 'type' | 'order'
>;

const builtinMeterProfiles = {
  'fronius-sunspec': [
    {
      key: 'phaseACurrent',
      label: 'Phase A Current',
      unit: 'A',
      bank: 'holding',
      address: 40073,
      type: 'uint16',
      scaleKey: 'currentScaleFactor'
    },
    {
      key: 'phaseBCurrent',
      label: 'Phase B Current',
      unit: 'A',
      bank: 'holding',
      address: 40074,
      type: 'uint16',
      scaleKey: 'currentScaleFactor'
    },
    {
      key: 'phaseCCurrent',
      label: 'Phase C Current',
      unit: 'A',
      bank: 'holding',
      address: 40075,
      type: 'uint16',
      scaleKey: 'currentScaleFactor'
    },
    {
      key: 'phaseAVoltage',
      label: 'Phase A Voltage',
      unit: 'V',
      bank: 'holding',
      address: 40080,
      type: 'uint16',
      scaleKey: 'voltageScaleFactor'
    },
    {
      key: 'phaseBVoltage',
      label: 'Phase B Voltage',
      unit: 'V',
      bank: 'holding',
      address: 40081,
      type: 'uint16',
      scaleKey: 'voltageScaleFactor'
    },
    {
      key: 'phaseCVoltage',
      label: 'Phase C Voltage',
      unit: 'V',
      bank: 'holding',
      address: 40082,
      type: 'uint16',
      scaleKey: 'voltageScaleFactor'
    },
    {
      key: 'frequency',
      label: 'Frequency',
      unit: 'Hz',
      bank: 'holding',
      address: 40086,
      type: 'uint16',
      scaleKey: 'frequencyScaleFactor'
    },
    {
      key: 'totalPower',
      label: 'AC Power',
      unit: 'W',
      bank: 'holding',
      address: 40084,
      type: 'uint16',
      scaleKey: 'powerScaleFactor'
    },
    {
      key: 'totalForwardEnergy',
      label: 'Lifetime Energy',
      unit: 'Wh',
      bank: 'holding',
      address: 40094,
      type: 'uint32',
      scaleKey: 'energyScaleFactor'
    },
    {
      key: 'dcVoltage',
      label: 'DC Voltage',
      unit: 'V',
      bank: 'holding',
      address: 40099,
      type: 'uint16',
      scaleKey: 'dcVoltageScaleFactor'
    },
    {
      key: 'cabinetTemperature',
      label: 'Cabinet Temperature',
      unit: 'C',
      bank: 'holding',
      address: 40101,
      type: 'int16',
      scaleKey: 'temperatureScaleFactor'
    },
    {
      key: 'status',
      label: 'Operating State',
      bank: 'holding',
      address: 40110,
      type: 'uint16'
    }
  ],
  'iammeter-wem3080t': [
    {
      key: 'phaseAVoltage',
      label: 'Phase A Voltage',
      unit: 'V',
      bank: 'holding',
      address: 0,
      type: 'uint16',
      scale: 0.01
    },
    {
      key: 'phaseACurrent',
      label: 'Phase A Current',
      unit: 'A',
      bank: 'holding',
      address: 1,
      type: 'uint16',
      scale: 0.01
    },
    {
      key: 'phaseAActivePower',
      label: 'Phase A Active Power',
      unit: 'W',
      bank: 'holding',
      address: 2,
      type: 'int32'
    },
    {
      key: 'phaseBVoltage',
      label: 'Phase B Voltage',
      unit: 'V',
      bank: 'holding',
      address: 10,
      type: 'uint16',
      scale: 0.01
    },
    {
      key: 'phaseBCurrent',
      label: 'Phase B Current',
      unit: 'A',
      bank: 'holding',
      address: 11,
      type: 'uint16',
      scale: 0.01
    },
    {
      key: 'phaseBActivePower',
      label: 'Phase B Active Power',
      unit: 'W',
      bank: 'holding',
      address: 12,
      type: 'int32'
    },
    {
      key: 'phaseCVoltage',
      label: 'Phase C Voltage',
      unit: 'V',
      bank: 'holding',
      address: 20,
      type: 'uint16',
      scale: 0.01
    },
    {
      key: 'phaseCCurrent',
      label: 'Phase C Current',
      unit: 'A',
      bank: 'holding',
      address: 21,
      type: 'uint16',
      scale: 0.01
    },
    {
      key: 'phaseCActivePower',
      label: 'Phase C Active Power',
      unit: 'W',
      bank: 'holding',
      address: 22,
      type: 'int32'
    },
    {
      key: 'frequency',
      label: 'Frequency',
      unit: 'Hz',
      bank: 'holding',
      address: 30,
      type: 'uint16',
      scale: 0.01
    },
    {
      key: 'totalPower',
      label: 'Total Power',
      unit: 'W',
      bank: 'holding',
      address: 32,
      type: 'int32'
    }
  ]
} as const satisfies Record<string, readonly MeterPointDefinition[]>;

const builtinMeterProfileAliases = new Map<string, string>([
  ['iammeter-wem3080', 'iammeter-wem3080t'],
  ['fronius-gen24', 'fronius-sunspec'],
  ['fronius', 'fronius-sunspec']
]);

const builtinMeterScalePoints = {
  'fronius-sunspec': [
    {
      key: 'currentScaleFactor',
      bank: 'holding',
      address: 40076,
      type: 'int16'
    },
    {
      key: 'voltageScaleFactor',
      bank: 'holding',
      address: 40083,
      type: 'int16'
    },
    {
      key: 'powerScaleFactor',
      bank: 'holding',
      address: 40085,
      type: 'int16'
    },
    {
      key: 'frequencyScaleFactor',
      bank: 'holding',
      address: 40087,
      type: 'int16'
    },
    {
      key: 'energyScaleFactor',
      bank: 'holding',
      address: 40097,
      type: 'int16'
    },
    {
      key: 'dcVoltageScaleFactor',
      bank: 'holding',
      address: 40100,
      type: 'int16'
    },
    {
      key: 'temperatureScaleFactor',
      bank: 'holding',
      address: 40102,
      type: 'int16'
    }
  ]
} as const satisfies Record<string, readonly MeterScalePointDefinition[]>;

export function listBuiltinMeterReaders(): string[] {
  return Object.keys(builtinMeterProfiles);
}

export function getBuiltinMeterProfile(
  profileId: string
): readonly MeterPointDefinition[] | null {
  const resolvedProfileId = builtinMeterProfileAliases.get(profileId) ?? profileId;
  return builtinMeterProfiles[resolvedProfileId as keyof typeof builtinMeterProfiles] ?? null;
}

export async function readBuiltinMeterProfile(
  client: ModbusTcpClient,
  profileId = 'iammeter-wem3080t'
): Promise<MeterReading> {
  const profile = getBuiltinMeterProfile(profileId);
  if (!profile) {
    throw new Error(`Unsupported built-in meter profile "${profileId}"`);
  }

  const points: MeterPointReading[] = [];
  const values: Record<string, number> = {};
  const rawValues: Record<string, number> = {};
  const resolvedProfileId = builtinMeterProfileAliases.get(profileId) ?? profileId;
  const scaleValues: Record<string, number> = {};

  const scaleProfile: readonly MeterScalePointDefinition[] =
    builtinMeterScalePoints[resolvedProfileId as keyof typeof builtinMeterScalePoints] ?? [];

  for (const scalePoint of scaleProfile) {
    const rawScale = await client.readValue({
      bank: scalePoint.bank,
      address: scalePoint.address,
      type: scalePoint.type,
      order: scalePoint.order
    });
    scaleValues[scalePoint.key] = Number(`1e${rawScale}`);
    rawValues[scalePoint.key] = rawScale;
  }

  for (const point of profile) {
    const rawValue = await client.readValue({
      bank: point.bank,
      address: point.address,
      type: point.type,
      order: point.order
    });
    const effectiveScale = point.scaleKey ? scaleValues[point.scaleKey] : point.scale;
    const value = effectiveScale == null ? rawValue : rawValue * effectiveScale;

    points.push({
      ...point,
      value,
      rawValue
    });
    values[point.key] = value;
    rawValues[point.key] = rawValue;
  }

  return {
    profileId,
    collectedAt: new Date().toISOString(),
    points,
    values,
    rawValues
  };
}

export function formatMeterReading(reading: MeterReading): string {
  const lines = [
    `Meter profile: ${reading.profileId}`,
    `Collected at: ${reading.collectedAt}`
  ];

  for (const point of reading.points) {
    const suffix = point.unit ? ` ${point.unit}` : '';
    lines.push(`- ${point.label}: ${point.value}${suffix} (raw ${point.rawValue})`);
  }

  return lines.join('\n');
}
