import type { DeviceRuntime } from '../core/device-runtime.ts';
import { getBuiltinMeterProfile } from '../clients/meter-reader.ts';
import {
  buildShellyEmeterReading,
  buildShellyIdentityPayload,
  buildShellyRelayPayload,
  buildShellySettingsEmeterPayload,
  buildShellySettingsPayload,
  buildShellyStatusPayload
} from './shelly-gen1.ts';
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
  const registerSections: ProtocolPreviewSection[] = [
    {
      id: 'holding-0-37',
      title: 'Holding Registers 0-37',
      description: 'Main contiguous block typically used by gateway and reader integrations.',
      kind: 'register-block',
      bank: 'holding',
      functionCode: 0x03,
      startAddress: 0,
      quantity: 38,
      words: tryReadRange(device, 'holding', 0, 38)
    }
  ];

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
        lines: [
          baseCommand,
          `Read FC03 holding 0-37 from ${host}:${device.listenPort} unit ${device.unitId}`,
          extendedWords.length > 0
            ? `Read FC03 holding 38-64 from ${host}:${device.listenPort} unit ${device.unitId}`
            : `No extended holding block is exposed by this profile`
        ]
      }
    ],
    debugHints: [
      baseCommand,
      `FC03 holding 0-37 on ${host}:${device.listenPort} unit ${device.unitId}`,
      extendedWords.length > 0 ? `FC03 holding 38-64 on ${host}:${device.listenPort}` : 'No extended holding block'
    ]
  };
}

function buildShellyPreview(
  device: DeviceRuntime,
  profile: DeviceProfileMetadata
): ProtocolPreview {
  const host = resolveDemoHost(device);
  const baseUrl = `http://${host}:${device.listenPort}`;

  return {
    title: 'Shelly Gen1 HTTP Output',
    summary: 'This device exposes Shelly 3EM-style local HTTP payloads. Focus on the JSON returned by the public device endpoints.',
    transport: device.transport,
    connection: buildConnectionRows(device, profile),
    sections: [
      {
        id: 'endpoint-map',
        title: 'Primary Endpoints',
        description: 'These are the payloads end users usually care about when integrating with a Shelly 3EM.',
        kind: 'table',
        rows: [
          { label: 'GET /shelly', value: `${baseUrl}/shelly`, note: 'device identity' },
          { label: 'GET /settings', value: `${baseUrl}/settings`, note: 'device settings' },
          { label: 'GET /status', value: `${baseUrl}/status`, note: 'aggregate live state' },
          { label: 'GET /emeter/0', value: `${baseUrl}/emeter/0`, note: 'phase A live meter' },
          { label: 'GET /emeter/1', value: `${baseUrl}/emeter/1`, note: 'phase B live meter' },
          { label: 'GET /emeter/2', value: `${baseUrl}/emeter/2`, note: 'phase C live meter' },
          { label: 'GET /relay/0', value: `${baseUrl}/relay/0`, note: 'relay state' }
        ]
      },
      {
        id: 'status',
        title: 'GET /status',
        description: 'Combined live payload used by many dashboard integrations.',
        kind: 'json',
        endpoint: `${baseUrl}/status`,
        method: 'GET',
        payload: buildShellyStatusPayload(device)
      },
      {
        id: 'emeters',
        title: 'Per-phase Meter Payloads',
        description: 'Each phase can also be queried individually through its own endpoint.',
        kind: 'table',
        rows: [0, 1, 2].map((index) => {
          const reading = buildShellyEmeterReading(device, index);
          return {
            label: `/emeter/${index}`,
            value: `${reading.power} W · ${reading.voltage} V`,
            note: `${reading.current} A · pf ${reading.pf}`
          };
        })
      },
      {
        id: 'relay',
        title: 'GET /relay/0',
        kind: 'json',
        endpoint: `${baseUrl}/relay/0`,
        method: 'GET',
        payload: buildShellyRelayPayload(device)
      },
      {
        id: 'settings-emeter',
        title: 'GET /settings/emeter/{index}',
        description: 'Per-phase configuration payload shape.',
        kind: 'json',
        endpoint: `${baseUrl}/settings/emeter/0`,
        method: 'GET',
        payload: buildShellySettingsEmeterPayload(0)
      },
      {
        id: 'identity',
        title: 'GET /shelly',
        kind: 'json',
        endpoint: `${baseUrl}/shelly`,
        method: 'GET',
        payload: buildShellyIdentityPayload(device)
      },
      {
        id: 'settings',
        title: 'GET /settings',
        kind: 'json',
        endpoint: `${baseUrl}/settings`,
        method: 'GET',
        payload: buildShellySettingsPayload(device)
      },
      {
        id: 'debug-hints',
        title: 'Console Debug',
        kind: 'text',
        lines: [
          `curl -s ${baseUrl}/status | jq`,
          `curl -s ${baseUrl}/emeter/0 | jq`,
          `curl -s '${baseUrl}/relay/0?turn=off' | jq`
        ]
      }
    ],
    debugHints: [
      `curl -s ${baseUrl}/status | jq`,
      `curl -s ${baseUrl}/emeter/0 | jq`,
      `curl -s '${baseUrl}/relay/0?turn=off' | jq`
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

  if (device.transport === 'shelly-gen1-http') {
    return buildShellyPreview(device, profile);
  }

  return buildModbusPreview(device, profile);
}
