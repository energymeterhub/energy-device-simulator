import type { DeviceRuntime } from '../core/device-runtime.ts';
import { getBuiltinMeterProfile } from '../clients/meter-reader.ts';
import {
  buildShellyPro3emRpcEmDataStatus,
  buildShellyPro3emRpcEmStatus,
  buildShellyRpcEndpointSummary
} from './shelly-pro3em-rpc.ts';
import type {
  DeviceProfileMetadata,
  ProtocolPreview,
  ProtocolPreviewRow,
  ProtocolPreviewSection,
  RegisterBankName
} from '../types.ts';

function resolveDemoHost(device: DeviceRuntime): string {
  return device.host === '0.0.0.0' ? '127.0.0.1' : device.host;
}

function formatValue(value: number, scale?: number, unit?: string): string {
  const scaled = scale == null ? value : value * scale;
  const digits = scale == null ? 2 : scale < 0.01 ? 4 : scale < 1 ? 3 : 2;
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits
  }).format(scaled);
  return unit ? `${formatted} ${unit}` : formatted;
}

function buildConnectionRows(device: DeviceRuntime, profile: DeviceProfileMetadata): ProtocolPreviewRow[] {
  return [
    {
      label: 'Transport',
      value: profile.transport
    },
    {
      label: 'Listen Address',
      value: `${resolveDemoHost(device)}:${device.listenPort}`
    },
    {
      label: 'Simulator Device',
      value: profile.productName
    },
    {
      label: 'Official Device Port',
      value: String(profile.defaultPort)
    },
    {
      label: 'Unit ID',
      value: String(device.unitId)
    }
  ];
}

function tryReadRange(
  device: DeviceRuntime,
  bank: RegisterBankName,
  startAddress: number,
  quantity: number
): number[] {
  try {
    return bank === 'holding'
      ? device.readHolding(startAddress, quantity)
      : device.readInput(startAddress, quantity);
  } catch {
    return [];
  }
}

function buildModbusPreview(
  device: DeviceRuntime,
  profile: DeviceProfileMetadata
): ProtocolPreview {
  const meterProfile = getBuiltinMeterProfile(profile.id) ?? getBuiltinMeterProfile(device.profileId ?? '');
  const pointRows = (meterProfile ?? []).map((point) => {
    const rawValue = device.getEntryValue(point.bank, point.address);
    return {
      label: point.label,
      value: formatValue(rawValue, point.scale, point.unit),
      note: `raw ${rawValue} · ${point.bank} ${point.address}`
    };
  });
  const host = resolveDemoHost(device);
  const baseCommand = `node --experimental-strip-types src/cli.ts read-meter --host ${host} --port ${device.listenPort} --unit ${device.unitId} --profile ${profile.id}`;
  const registerSections: ProtocolPreviewSection[] = [];
  let debugLines: string[] = [baseCommand];
  let debugHints: string[] = [baseCommand];

  if (profile.id === 'fronius-sunspec' || device.profileId === 'fronius-sunspec') {
    const signatureWords = tryReadRange(device, 'holding', 40000, 2);
    const commonWords = tryReadRange(device, 'holding', 40002, 68);
    const inverterWords = tryReadRange(device, 'holding', 40070, 52);

    registerSections.push(
      {
        id: 'sunspec-signature',
        title: 'SunSpec Signature 40000-40001',
        description: 'Discovery starts with the SunSpec magic value at holding registers 40000-40001.',
        kind: 'register-block',
        bank: 'holding',
        functionCode: 0x03,
        startAddress: 40000,
        quantity: 2,
        words: signatureWords
      },
      {
        id: 'sunspec-common',
        title: 'Common Model 40002-40069',
        description: 'Model 1 metadata block with manufacturer, model, firmware, and serial details.',
        kind: 'register-block',
        bank: 'holding',
        functionCode: 0x03,
        startAddress: 40002,
        quantity: 68,
        words: commonWords
      },
      {
        id: 'sunspec-inverter-103',
        title: 'Inverter Model 103 40070-40121',
        description: 'Three-phase inverter block with AC current, voltage, power, frequency, energy, and status.',
        kind: 'register-block',
        bank: 'holding',
        functionCode: 0x03,
        startAddress: 40070,
        quantity: 52,
        words: inverterWords
      }
    );

    debugLines = [
      baseCommand,
      `Read FC03 holding 40000-40001 from ${host}:${device.listenPort} unit ${device.unitId}`,
      `Read FC03 holding 40002-40069 from ${host}:${device.listenPort} unit ${device.unitId}`,
      `Read FC03 holding 40070-40121 from ${host}:${device.listenPort} unit ${device.unitId}`
    ];
    debugHints = [
      baseCommand,
      `FC03 holding 40000-40001 on ${host}:${device.listenPort} unit ${device.unitId}`,
      `FC03 holding 40002-40069 on ${host}:${device.listenPort}`,
      `FC03 holding 40070-40121 on ${host}:${device.listenPort}`
    ];
  } else {
    registerSections.push({
      id: 'holding-0-37',
      title: 'Holding Registers 0-37',
      description: 'Main contiguous block typically used by gateway and reader integrations.',
      kind: 'register-block',
      bank: 'holding',
      functionCode: 0x03,
      startAddress: 0,
      quantity: 38,
      words: tryReadRange(device, 'holding', 0, 38)
    });

    const extendedWords = tryReadRange(device, 'holding', 38, 27);
    if (extendedWords.length > 0) {
      registerSections.push({
        id: 'holding-38-64',
        title: 'Holding Registers 38-64',
        description: 'Extended reactive energy and device metadata block.',
        kind: 'register-block',
        bank: 'holding',
        functionCode: 0x03,
        startAddress: 38,
        quantity: 27,
        words: extendedWords
      });
    }

    debugLines = [
      baseCommand,
      `Read FC03 holding 0-37 from ${host}:${device.listenPort} unit ${device.unitId}`,
      extendedWords.length > 0
        ? `Read FC03 holding 38-64 from ${host}:${device.listenPort} unit ${device.unitId}`
        : `No extended holding block is exposed by this profile`
    ];
    debugHints = [
      baseCommand,
      `FC03 holding 0-37 on ${host}:${device.listenPort} unit ${device.unitId}`,
      extendedWords.length > 0 ? `FC03 holding 38-64 on ${host}:${device.listenPort}` : 'No extended holding block'
    ];
  }

  return {
    title: 'Modbus TCP Output',
    summary: 'This device exposes raw Modbus words. The main thing to validate is the returned register blocks and their decoded values.',
    transport: device.transport,
    connection: buildConnectionRows(device, profile),
    sections: [
      {
        id: 'decoded-points',
        title: 'Decoded Meter Points',
        description: 'Human-readable values derived from the live register map.',
        kind: 'table',
        rows: pointRows
      },
      ...registerSections,
      {
        id: 'debug-hints',
        title: 'Console Debug',
        description: 'Use these commands when you want to validate the Modbus output from a terminal.',
        kind: 'text',
        lines: debugLines
      }
    ],
    debugHints
  };
}

function buildShellyPreview(
  device: DeviceRuntime,
  profile: DeviceProfileMetadata
): ProtocolPreview {
  const host = resolveDemoHost(device);
  const baseUrl = `http://${host}:${device.listenPort}`;
  const phaseSummary = buildShellyRpcEndpointSummary(device);

  return {
    title: 'Shelly Pro 3EM RPC Output',
    summary: 'This device exposes the Shelly Pro 3EM local RPC payloads. Focus on the JSON returned by the real-time EM and cumulative EMData endpoints.',
    transport: device.transport,
    connection: buildConnectionRows(device, profile),
    sections: [
      {
        id: 'endpoint-map',
        title: 'Primary Endpoints',
        description: 'These are the two RPC endpoints most integrations need for Shelly Pro 3EM in default triphase mode.',
        kind: 'table',
        rows: [
          { label: 'GET /rpc/EM.GetStatus?id=0', value: `${baseUrl}/rpc/EM.GetStatus?id=0`, note: 'instantaneous three-phase values' },
          { label: 'GET /rpc/EMData.GetStatus?id=0', value: `${baseUrl}/rpc/EMData.GetStatus?id=0`, note: 'cumulative import/export energy' }
        ]
      },
      {
        id: 'em-status',
        title: 'GET /rpc/EM.GetStatus?id=0',
        description: 'Real-time voltage, current, and active power for the three phases.',
        kind: 'json',
        endpoint: `${baseUrl}/rpc/EM.GetStatus?id=0`,
        method: 'GET',
        payload: buildShellyPro3emRpcEmStatus(device)
      },
      {
        id: 'emdata-status',
        title: 'GET /rpc/EMData.GetStatus?id=0',
        description: 'Cumulative forward and reverse energy counters for each phase and the total.',
        kind: 'json',
        endpoint: `${baseUrl}/rpc/EMData.GetStatus?id=0`,
        method: 'GET',
        payload: buildShellyPro3emRpcEmDataStatus(device)
      },
      {
        id: 'phase-summary',
        title: 'Per-phase Snapshot',
        description: 'Quick view of the values that are split across the EM and EMData RPC payloads.',
        kind: 'table',
        rows: phaseSummary.map((reading, index) => {
          return {
            label: `Phase ${String.fromCharCode(65 + index)}`,
            value: `${reading.activePower} W · ${reading.voltage} V`,
            note: `${reading.current} A · import ${reading.forwardEnergyWh} Wh · export ${reading.reverseEnergyWh} Wh`
          };
        })
      },
      {
        id: 'debug-hints',
        title: 'Console Debug',
        kind: 'text',
        lines: [
          `curl -s "${baseUrl}/rpc/EM.GetStatus?id=0" | jq`,
          `curl -s "${baseUrl}/rpc/EMData.GetStatus?id=0" | jq`
        ]
      }
    ],
    debugHints: [
      `curl -s "${baseUrl}/rpc/EM.GetStatus?id=0" | jq`,
      `curl -s "${baseUrl}/rpc/EMData.GetStatus?id=0" | jq`
    ]
  };
}

export function buildProtocolPreview(
  device: DeviceRuntime | null,
  profile: DeviceProfileMetadata | null
): ProtocolPreview | null {
  if (!device || !profile) {
    return null;
  }

  if (device.transport === 'shelly-rpc-http') {
    return buildShellyPreview(device, profile);
  }

  return buildModbusPreview(device, profile);
}
