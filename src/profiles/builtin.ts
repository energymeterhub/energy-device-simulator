import type {
  DeviceProfileDefinition,
  DeviceProfileMetadata,
  DeviceRegistersDefinition
} from '../types.ts';

function cloneRegisters(registers: DeviceRegistersDefinition): DeviceRegistersDefinition {
  return structuredClone(registers);
}

function encodeAsciiRegisters(text: string, registerCount: number): number[] {
  const normalized = text.padEnd(registerCount * 2, ' ').slice(0, registerCount * 2);
  const words: number[] = [];

  for (let index = 0; index < registerCount; index += 1) {
    const left = normalized.charCodeAt(index * 2);
    const right = normalized.charCodeAt(index * 2 + 1);
    words.push((left << 8) | right);
  }

  return words;
}

function createSequentialRegisters(
  startAddress: number,
  words: number[],
  prefix: string
): Record<number, { name: string; type: 'uint16'; value: number }> {
  return Object.fromEntries(
    words.map((value, index) => [
      startAddress + index,
      {
        name: `${prefix}_${index}`,
        type: 'uint16' as const,
        value
      }
    ])
  );
}

const iammeterWem3080Registers: DeviceRegistersDefinition = {
  holding: {
    0: { name: 'phase_a_voltage_raw', type: 'uint16', value: 23041 },
    1: { name: 'phase_a_current_raw', type: 'uint16', value: 1234 },
    2: { name: 'phase_a_active_power_raw', type: 'int32', value: 2810 },
    4: { name: 'phase_a_forward_energy_raw', type: 'uint32', value: 345600 },
    6: { name: 'phase_a_reverse_energy_raw', type: 'uint32', value: 0 },
    8: { name: 'phase_a_power_factor_raw', type: 'uint16', value: 998 },
    9: { name: 'model_number', type: 'uint16', value: 2 },
    10: { name: 'phase_b_voltage_raw', type: 'uint16', value: 22995 },
    11: { name: 'phase_b_current_raw', type: 'uint16', value: 1010 },
    12: { name: 'phase_b_active_power_raw', type: 'int32', value: 2260 },
    14: { name: 'phase_b_forward_energy_raw', type: 'uint32', value: 312000 },
    16: { name: 'phase_b_reverse_energy_raw', type: 'uint32', value: 0 },
    18: { name: 'phase_b_power_factor_raw', type: 'uint16', value: 991 },
    19: { name: 'phase_b_pad', type: 'uint16', value: 0 },
    20: { name: 'phase_c_voltage_raw', type: 'uint16', value: 23112 },
    21: { name: 'phase_c_current_raw', type: 'uint16', value: 850 },
    22: { name: 'phase_c_active_power_raw', type: 'int32', value: 1940 },
    24: { name: 'phase_c_forward_energy_raw', type: 'uint32', value: 288000 },
    26: { name: 'phase_c_reverse_energy_raw', type: 'uint32', value: 0 },
    28: { name: 'phase_c_power_factor_raw', type: 'uint16', value: 986 },
    29: { name: 'phase_c_pad', type: 'uint16', value: 0 },
    30: { name: 'frequency_raw', type: 'uint16', value: 5000 },
    31: { name: 'frequency_pad', type: 'uint16', value: 0 },
    32: { name: 'total_power_raw', type: 'int32', value: 7010 },
    34: { name: 'total_forward_energy_raw', type: 'uint32', value: 945600 },
    36: { name: 'total_reverse_energy_raw', type: 'uint32', value: 0 },
    38: { name: 'phase_a_reactive_power_raw', type: 'int32', value: 420 },
    40: { name: 'phase_a_inductive_kvarh_raw', type: 'uint32', value: 12600 },
    42: { name: 'phase_a_capacitive_kvarh_raw', type: 'uint32', value: 0 },
    44: { name: 'phase_b_reactive_power_raw', type: 'int32', value: 310 },
    46: { name: 'phase_b_inductive_kvarh_raw', type: 'uint32', value: 9400 },
    48: { name: 'phase_b_capacitive_kvarh_raw', type: 'uint32', value: 0 },
    50: { name: 'phase_c_reactive_power_raw', type: 'int32', value: 260 },
    52: { name: 'phase_c_inductive_kvarh_raw', type: 'uint32', value: 8800 },
    54: { name: 'phase_c_capacitive_kvarh_raw', type: 'uint32', value: 0 },
    56: { name: 'serial_number_part_1', type: 'uint16', value: 1001 },
    57: { name: 'serial_number_part_2', type: 'uint16', value: 1002 },
    58: { name: 'serial_number_part_3', type: 'uint16', value: 1003 },
    59: { name: 'serial_number_part_4', type: 'uint16', value: 1004 },
    60: { name: 'serial_number_part_5', type: 'uint16', value: 1005 },
    61: { name: 'serial_number_part_6', type: 'uint16', value: 1006 },
    62: { name: 'serial_number_part_7', type: 'uint16', value: 1007 },
    63: { name: 'serial_number_part_8', type: 'uint16', value: 1008 },
    64: { name: 'runtime_seconds', type: 'uint16', value: 3600 }
  }
};

const shelly3emRegisters: DeviceRegistersDefinition = {
  holding: {
    100: { name: 'relay_0_ison', type: 'uint16', value: 1, writable: true }
  },
  input: {
    0: { name: 'phase_a_power', type: 'float32', value: 612.4 },
    2: { name: 'phase_a_pf', type: 'float32', value: 0.972 },
    4: { name: 'phase_a_voltage', type: 'float32', value: 229.8 },
    6: { name: 'phase_a_total', type: 'float32', value: 12840.52 },
    8: { name: 'phase_a_total_returned', type: 'float32', value: 12.44 },
    20: { name: 'phase_b_power', type: 'float32', value: 421.8 },
    22: { name: 'phase_b_pf', type: 'float32', value: 0.955 },
    24: { name: 'phase_b_voltage', type: 'float32', value: 231.1 },
    26: { name: 'phase_b_total', type: 'float32', value: 10328.16 },
    28: { name: 'phase_b_total_returned', type: 'float32', value: 8.12 },
    40: { name: 'phase_c_power', type: 'float32', value: 318.6 },
    42: { name: 'phase_c_pf', type: 'float32', value: 0.948 },
    44: { name: 'phase_c_voltage', type: 'float32', value: 228.9 },
    46: { name: 'phase_c_total', type: 'float32', value: 9164.73 },
    48: { name: 'phase_c_total_returned', type: 'float32', value: 5.71 }
  }
};

const froniusSunspecCommonBlock = new Array<number>(66).fill(0);
encodeAsciiRegisters('Fronius', 8).forEach((word, index) => {
  froniusSunspecCommonBlock[index] = word;
});
encodeAsciiRegisters('GEN24 Symo', 8).forEach((word, index) => {
  froniusSunspecCommonBlock[8 + index] = word;
});
encodeAsciiRegisters('SunSpec', 8).forEach((word, index) => {
  froniusSunspecCommonBlock[16 + index] = word;
});
encodeAsciiRegisters('1.28.7', 8).forEach((word, index) => {
  froniusSunspecCommonBlock[24 + index] = word;
});
encodeAsciiRegisters('FGEN24A01234', 16).forEach((word, index) => {
  froniusSunspecCommonBlock[32 + index] = word;
});

const froniusSunspecModel103Block = new Array<number>(50).fill(0);
froniusSunspecModel103Block[0] = 191;
froniusSunspecModel103Block[1] = 63;
froniusSunspecModel103Block[2] = 65;
froniusSunspecModel103Block[3] = 63;
froniusSunspecModel103Block[4] = 0xffff;
froniusSunspecModel103Block[5] = 3990;
froniusSunspecModel103Block[6] = 4010;
froniusSunspecModel103Block[7] = 4000;
froniusSunspecModel103Block[8] = 2301;
froniusSunspecModel103Block[9] = 2294;
froniusSunspecModel103Block[10] = 2310;
froniusSunspecModel103Block[11] = 0xffff;
froniusSunspecModel103Block[12] = 4380;
froniusSunspecModel103Block[13] = 0;
froniusSunspecModel103Block[14] = 5000;
froniusSunspecModel103Block[15] = 0xfffe;
froniusSunspecModel103Block[16] = 4480;
froniusSunspecModel103Block[17] = 0;
froniusSunspecModel103Block[18] = 250;
froniusSunspecModel103Block[19] = 0;
froniusSunspecModel103Block[20] = 978;
froniusSunspecModel103Block[21] = 0xfffd;
froniusSunspecModel103Block[22] = 19;
froniusSunspecModel103Block[23] = 9868;
froniusSunspecModel103Block[24] = 0;
froniusSunspecModel103Block[25] = 121;
froniusSunspecModel103Block[26] = 0xffff;
froniusSunspecModel103Block[27] = 620;
froniusSunspecModel103Block[28] = 0;
froniusSunspecModel103Block[29] = 4520;
froniusSunspecModel103Block[30] = 0;
froniusSunspecModel103Block[31] = 29;
froniusSunspecModel103Block[32] = 0;
froniusSunspecModel103Block[33] = 31;
froniusSunspecModel103Block[34] = 0;
froniusSunspecModel103Block[35] = 0;
froniusSunspecModel103Block[36] = 0;
froniusSunspecModel103Block[37] = 0;
froniusSunspecModel103Block[38] = 4;

const froniusSunspecRegisters: DeviceRegistersDefinition = {
  holding: {
    40000: { name: 'sunspec_id_0', type: 'uint16', value: 0x5375 },
    40001: { name: 'sunspec_id_1', type: 'uint16', value: 0x6e53 },
    40002: { name: 'common_model_id', type: 'uint16', value: 1 },
    40003: { name: 'common_model_length', type: 'uint16', value: 66 },
    ...createSequentialRegisters(40004, froniusSunspecCommonBlock, 'common'),
    40070: { name: 'inverter_model_id', type: 'uint16', value: 103 },
    40071: { name: 'inverter_model_length', type: 'uint16', value: 50 },
    ...createSequentialRegisters(40072, froniusSunspecModel103Block, 'inv103'),
    40122: { name: 'end_model_id', type: 'uint16', value: 0xffff },
    40123: { name: 'end_model_length', type: 'uint16', value: 0 }
  }
};

const builtinProfiles: DeviceProfileDefinition[] = [
  {
    id: 'fronius-sunspec',
    title: 'Fronius SunSpec Inverter',
    description:
      'SunSpec Modbus TCP profile representing a Fronius GEN24 or Symo-style inverter with the standard SunSpec discovery chain starting at register 40000.',
    manufacturerId: 'fronius',
    manufacturerName: 'Fronius',
    productId: 'fronius-sunspec',
    productName: 'Fronius GEN24 / Symo (SunSpec)',
    transport: 'modbus-tcp',
    defaultPort: 502,
    compatibility: 'vendor-compat',
    notes: [
      'The simulator exposes the SunSpec signature at holding registers 40000-40001.',
      'A Common model (ID 1) is followed by inverter model 103, then an end marker at 40122.',
      'The first implementation focuses on the public SunSpec int+SF fields needed for power, energy, phase voltage/current, frequency, and status.'
    ],
    device: {
      kind: 'inverter',
      model: 'Fronius SunSpec Inverter',
      transport: 'modbus-tcp',
      unitId: 1,
      port: 502,
      registers: cloneRegisters(froniusSunspecRegisters),
      behaviors: [
        {
          id: 'fronius-phase-a-current',
          type: 'randomWalk',
          bank: 'holding',
          address: 40073,
          min: 55,
          max: 78,
          step: 2,
          intervalMs: 2000
        },
        {
          id: 'fronius-phase-b-current',
          type: 'randomWalk',
          bank: 'holding',
          address: 40074,
          min: 58,
          max: 81,
          step: 2,
          intervalMs: 2000
        },
        {
          id: 'fronius-phase-c-current',
          type: 'randomWalk',
          bank: 'holding',
          address: 40075,
          min: 54,
          max: 77,
          step: 2,
          intervalMs: 2000
        },
        {
          id: 'fronius-total-power',
          type: 'randomWalk',
          bank: 'holding',
          address: 40084,
          min: 3600,
          max: 5200,
          step: 70,
          intervalMs: 2000
        },
        {
          id: 'fronius-phase-a-voltage',
          type: 'sineWave',
          bank: 'holding',
          address: 40080,
          min: 2288,
          max: 2312,
          periodMs: 12000,
          intervalMs: 2000
        },
        {
          id: 'fronius-phase-b-voltage',
          type: 'sineWave',
          bank: 'holding',
          address: 40081,
          min: 2286,
          max: 2309,
          periodMs: 14000,
          intervalMs: 2000
        },
        {
          id: 'fronius-phase-c-voltage',
          type: 'sineWave',
          bank: 'holding',
          address: 40082,
          min: 2290,
          max: 2315,
          periodMs: 16000,
          intervalMs: 2000
        }
      ]
    }
  },
  {
    id: 'iammeter-wem3080t',
    title: 'IAMMETER WEM3080T',
    description:
      'Official-style IAMMETER WEM3080T Modbus TCP profile with the raw three-phase holding-register layout used by gateway integrations.',
    manufacturerId: 'iammeter',
    manufacturerName: 'IAMMETER',
    productId: 'wem3080t',
    productName: 'WEM3080T',
    transport: 'modbus-tcp',
    defaultPort: 502,
    compatibility: 'vendor-compat',
    notes: [
      'Registers follow the official IAMMETER WEM3080T Modbus/TCP map, including pad registers and extended values through address 64.',
      'Values in the simulator are raw Modbus values, not pre-scaled engineering units.',
      'Phase power and total power change every 2 seconds so polling clients can observe live updates.'
    ],
    device: {
      kind: 'meter',
      model: 'IAMMETER WEM3080T',
      transport: 'modbus-tcp',
      unitId: 1,
      port: 502,
      registers: cloneRegisters(iammeterWem3080Registers),
      behaviors: [
        {
          id: 'iammeter-phase-a-power',
          type: 'randomWalk',
          bank: 'holding',
          address: 2,
          min: 2400,
          max: 3200,
          step: 60,
          intervalMs: 2000
        },
        {
          id: 'iammeter-phase-b-power',
          type: 'randomWalk',
          bank: 'holding',
          address: 12,
          min: 1900,
          max: 2700,
          step: 50,
          intervalMs: 2000
        },
        {
          id: 'iammeter-phase-c-power',
          type: 'randomWalk',
          bank: 'holding',
          address: 22,
          min: 1500,
          max: 2300,
          step: 40,
          intervalMs: 2000
        },
        {
          id: 'iammeter-total-power',
          type: 'randomWalk',
          bank: 'holding',
          address: 32,
          min: 6000,
          max: 8200,
          step: 90,
          intervalMs: 2000
        }
      ]
    }
  },
  {
    id: 'shelly-3em',
    title: 'Shelly Pro 3EM',
    description:
      'Shelly Pro 3EM local RPC profile using `/rpc/EM.GetStatus?id=0` and `/rpc/EMData.GetStatus?id=0` for three-phase data.',
    manufacturerId: 'shelly',
    manufacturerName: 'Shelly',
    productId: 'shelly-pro-3em',
    productName: 'Shelly Pro 3EM',
    transport: 'shelly-rpc-http',
    defaultPort: 80,
    compatibility: 'vendor-compat',
    notes: [
      'Local API transport is HTTP RPC, not Modbus TCP.',
      'The default real-device local API port is TCP 80; the bundled example uses 18080 to avoid privileged-port issues in development.',
      'The simulator exposes the Shelly Pro 3EM RPC endpoints `/rpc/EM.GetStatus?id=0` and `/rpc/EMData.GetStatus?id=0`.'
    ],
    device: {
      kind: 'meter',
      model: 'Shelly Pro 3EM',
      transport: 'shelly-rpc-http',
      unitId: 1,
      port: 18080,
      registers: cloneRegisters(shelly3emRegisters),
      behaviors: [
        {
          id: 'shelly-phase-a-power',
          type: 'randomWalk',
          bank: 'input',
          address: 0,
          min: 420,
          max: 760,
          step: 18,
          intervalMs: 2000
        },
        {
          id: 'shelly-phase-b-power',
          type: 'randomWalk',
          bank: 'input',
          address: 20,
          min: 260,
          max: 560,
          step: 16,
          intervalMs: 2000
        },
        {
          id: 'shelly-phase-c-power',
          type: 'randomWalk',
          bank: 'input',
          address: 40,
          min: 180,
          max: 460,
          step: 14,
          intervalMs: 2000
        },
        {
          id: 'shelly-phase-a-voltage',
          type: 'sineWave',
          bank: 'input',
          address: 4,
          min: 227,
          max: 233,
          periodMs: 12000,
          intervalMs: 2000
        },
        {
          id: 'shelly-phase-b-voltage',
          type: 'sineWave',
          bank: 'input',
          address: 24,
          min: 228,
          max: 234,
          periodMs: 14000,
          intervalMs: 2000
        },
        {
          id: 'shelly-phase-c-voltage',
          type: 'sineWave',
          bank: 'input',
          address: 44,
          min: 226,
          max: 232,
          periodMs: 16000,
          intervalMs: 2000
        }
      ]
    }
  }
];

const builtinProfileAliases = new Map<string, string>([
  ['iammeter-wem3080', 'iammeter-wem3080t'],
  ['fronius-gen24', 'fronius-sunspec'],
  ['fronius', 'fronius-sunspec']
]);

const builtinProfilesById = new Map<string, DeviceProfileDefinition>(
  builtinProfiles.map((profile) => [profile.id, profile])
);

export function listBuiltinProfiles(): DeviceProfileMetadata[] {
  return builtinProfiles.map(({ device: _device, ...metadata }) => ({
    ...metadata
  }));
}

export function resolveBuiltinProfileId(profileId: string): string {
  return builtinProfileAliases.get(profileId) ?? profileId;
}

export function getBuiltinProfile(profileId: string): DeviceProfileDefinition | null {
  const profile = builtinProfilesById.get(resolveBuiltinProfileId(profileId));
  return profile ? structuredClone(profile) : null;
}
