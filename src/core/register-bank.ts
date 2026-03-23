import {
  assertRegisterWord,
  decodeValue,
  encodeValue,
  getRegisterLength
} from './register-codec.ts';
import type {
  DeviceRegistersDefinition,
  NormalizedRegisterEntry,
  RawRegisterDump,
  RegisterBankName,
  RegisterEntryInput,
  RegisterEntrySnapshot
} from '../types.ts';

const BANKS: RegisterBankName[] = ['holding', 'input'];

interface EntryAddressInfo {
  startAddress: number;
  writable: boolean;
}

type NormalizedEntrySeed = Omit<NormalizedRegisterEntry, 'address' | 'bank' | 'length'>;

function assertBank(bank: string): asserts bank is RegisterBankName {
  if (!BANKS.includes(bank as RegisterBankName)) {
    throw new Error(`Unsupported bank "${bank}"`);
  }
}

function normalizeAddress(address: number | string): number {
  const numericAddress = Number(address);

  if (!Number.isInteger(numericAddress) || numericAddress < 0 || numericAddress > 0xffff) {
    throw new Error(`Invalid register address "${address}"`);
  }

  return numericAddress;
}

function normalizeEntry(rawEntry: RegisterEntryInput, bank: RegisterBankName): NormalizedEntrySeed {
  if (typeof rawEntry === 'number') {
    return {
      name: null,
      description: null,
      type: 'uint16',
      value: rawEntry,
      writable: false,
      order: 'ABCD'
    };
  }

  if (!rawEntry || typeof rawEntry !== 'object') {
    throw new Error(`Invalid ${bank} register definition`);
  }

  return {
    name: rawEntry.name ?? null,
    description: rawEntry.description ?? null,
    type: rawEntry.type ?? 'uint16',
    value: rawEntry.value ?? 0,
    writable: rawEntry.writable === true,
    order: rawEntry.order ?? 'ABCD'
  };
}

export class RegisterBank {
  values: Record<RegisterBankName, Map<number, number>>;

  entries: Record<RegisterBankName, Map<number, NormalizedRegisterEntry>>;

  addressIndex: Record<RegisterBankName, Map<number, EntryAddressInfo>>;

  constructor(definition: DeviceRegistersDefinition = {}) {
    this.values = {
      holding: new Map<number, number>(),
      input: new Map<number, number>()
    };
    this.entries = {
      holding: new Map<number, NormalizedRegisterEntry>(),
      input: new Map<number, NormalizedRegisterEntry>()
    };
    this.addressIndex = {
      holding: new Map<number, EntryAddressInfo>(),
      input: new Map<number, EntryAddressInfo>()
    };

    this.load(definition);
  }

  load(definition: DeviceRegistersDefinition = {}): void {
    for (const bank of BANKS) {
      const entries = definition[bank] ?? {};
      for (const [addressKey, rawEntry] of Object.entries(entries)) {
        const address = normalizeAddress(addressKey);
        const entry = normalizeEntry(rawEntry, bank);
        const length = getRegisterLength(entry.type);
        const encoded = encodeValue(entry);
        const metadata: NormalizedRegisterEntry = {
          ...entry,
          bank,
          address,
          length
        };

        if (this.entries[bank].has(address)) {
          throw new Error(`Duplicate ${bank} entry at address ${address}`);
        }

        for (let offset = 0; offset < length; offset += 1) {
          const registerAddress = address + offset;
          const encodedValue = encoded[offset];

          if (this.addressIndex[bank].has(registerAddress)) {
            throw new Error(`Overlapping ${bank} register at address ${registerAddress}`);
          }

          if (encodedValue == null) {
            throw new Error(`Missing encoded value for ${bank} register at address ${registerAddress}`);
          }

          this.values[bank].set(registerAddress, encodedValue);
          this.addressIndex[bank].set(registerAddress, {
            startAddress: address,
            writable: metadata.writable
          });
        }

        this.entries[bank].set(address, metadata);
      }
    }
  }

  getEntry(bank: RegisterBankName, address: number): NormalizedRegisterEntry | null {
    return this.entries[bank].get(normalizeAddress(address)) ?? null;
  }

  readRange(bank: RegisterBankName, startAddress: number, quantity: number): number[] {
    const start = normalizeAddress(startAddress);
    const count = Number(quantity);

    if (!Number.isInteger(count) || count < 1 || count > 125) {
      throw new Error(`Invalid register quantity "${quantity}"`);
    }

    const values: number[] = [];

    for (let offset = 0; offset < count; offset += 1) {
      const registerAddress = start + offset;
      const value = this.values[bank].get(registerAddress);

      if (value == null) {
        throw new Error(`Undefined ${bank} register at address ${registerAddress}`);
      }

      values.push(value);
    }

    return values;
  }

  setRawRegisters(
    bank: RegisterBankName,
    startAddress: number,
    rawValues: number[],
    options: { force?: boolean } = {}
  ): void {
    const start = normalizeAddress(startAddress);
    const force = options.force === true;

    if (!Array.isArray(rawValues) || rawValues.length === 0) {
      throw new Error('rawValues must be a non-empty array');
    }

    const normalizedValues = rawValues.map(assertRegisterWord);

    for (let offset = 0; offset < normalizedValues.length; offset += 1) {
      const registerAddress = start + offset;
      const addressInfo = this.addressIndex[bank].get(registerAddress);

      if (!addressInfo) {
        throw new Error(`Undefined ${bank} register at address ${registerAddress}`);
      }

      if (bank === 'holding' && !addressInfo.writable && !force) {
        throw new Error(`Holding register at address ${registerAddress} is read-only`);
      }
    }

    for (let offset = 0; offset < normalizedValues.length; offset += 1) {
      const value = normalizedValues[offset];
      if (value == null) {
        throw new Error(`Missing raw register value at index ${offset}`);
      }
      this.values[bank].set(start + offset, value);
    }
  }

  writeRange(startAddress: number, rawValues: number[]): void {
    this.setRawRegisters('holding', startAddress, rawValues);
  }

  getEntryValue(bank: RegisterBankName, address: number): number {
    const entry = this.getEntry(bank, address);
    if (!entry) {
      throw new Error(`Unknown ${bank} entry at address ${address}`);
    }

    const registers = this.readRange(bank, entry.address, entry.length);
    return decodeValue(entry.type, registers, entry.order);
  }

  setEntryValue(
    bank: RegisterBankName,
    address: number,
    value: number,
    options: { force?: boolean } = {}
  ): void {
    const entry = this.getEntry(bank, address);
    if (!entry) {
      throw new Error(`Unknown ${bank} entry at address ${address}`);
    }

    if (bank === 'holding' && !entry.writable && options.force !== true) {
      throw new Error(`Holding entry at address ${address} is read-only`);
    }

    const encoded = encodeValue({
      type: entry.type,
      value,
      order: entry.order
    });

    this.setRawRegisters(bank, entry.address, encoded, options);
  }

  listEntries(bank: RegisterBankName): RegisterEntrySnapshot[];
  listEntries(): Record<RegisterBankName, RegisterEntrySnapshot[]>;
  listEntries(bank?: RegisterBankName): RegisterEntrySnapshot[] | Record<RegisterBankName, RegisterEntrySnapshot[]> {
    const banks = bank ? [bank] : BANKS;
    const result: Record<RegisterBankName, RegisterEntrySnapshot[]> = {
      holding: [],
      input: []
    };

    for (const bankName of banks) {
      result[bankName] = [...this.entries[bankName].values()]
        .sort((left, right) => left.address - right.address)
        .map((entry) => ({
          address: entry.address,
          bank: entry.bank,
          name: entry.name,
          description: entry.description,
          type: entry.type,
          order: entry.order,
          writable: entry.writable,
          length: entry.length,
          value: this.getEntryValue(entry.bank, entry.address),
          registers: this.readRange(entry.bank, entry.address, entry.length)
        }));
    }

    return bank ? result[bank] : result;
  }

  dumpRaw(bank: RegisterBankName): RawRegisterDump {
    return Object.fromEntries(
      [...this.values[bank].entries()].sort((left, right) => left[0] - right[0])
    );
  }

  findTouchedEntries(
    bank: RegisterBankName,
    startAddress: number,
    quantity: number
  ): NormalizedRegisterEntry[] {
    const start = normalizeAddress(startAddress);
    const count = Number(quantity);

    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid touched-entry quantity "${quantity}"`);
    }

    const touchedStartAddresses = new Set<number>();

    for (let offset = 0; offset < count; offset += 1) {
      const registerAddress = start + offset;
      const addressInfo = this.addressIndex[bank].get(registerAddress);
      if (!addressInfo) {
        throw new Error(`Undefined ${bank} register at address ${registerAddress}`);
      }
      touchedStartAddresses.add(addressInfo.startAddress);
    }

    return [...touchedStartAddresses]
      .map((entryAddress) => this.entries[bank].get(entryAddress) ?? null)
      .filter((entry): entry is NormalizedRegisterEntry => entry != null)
      .sort((left, right) => left.address - right.address);
  }
}
