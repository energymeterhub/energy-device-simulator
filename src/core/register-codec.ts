import type { RegisterType } from '../types.ts';

const TYPE_LENGTHS: Readonly<Record<RegisterType, 1 | 2>> = Object.freeze({
  uint16: 1,
  int16: 1,
  uint32: 2,
  int32: 2,
  float32: 2
});

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function normalizeOrder(order: string | null | undefined): string {
  if (order == null) {
    return 'ABCD';
  }

  if (!/^[ABCD]{4}$/.test(order) || new Set(order).size !== 4) {
    throw new Error(`Unsupported byte order "${order}"`);
  }

  return order;
}

function assertType(type: string): asserts type is RegisterType {
  if (!(type in TYPE_LENGTHS)) {
    throw new Error(`Unsupported register type "${type}"`);
  }
}

function reorderBytesForEncode(bytes: Buffer, order: string): Buffer {
  if (bytes.length !== 4) {
    return bytes;
  }

  const normalizedOrder = normalizeOrder(order);
  const ordered = Buffer.alloc(4);

  for (let index = 0; index < normalizedOrder.length; index += 1) {
    const label = normalizedOrder[index] ?? '';
    const sourceIndex = 'ABCD'.indexOf(label);
    ordered[index] = bytes.readUInt8(sourceIndex);
  }

  return ordered;
}

function restoreBytesForDecode(bytes: Buffer, order: string): Buffer {
  if (bytes.length !== 4) {
    return bytes;
  }

  const normalizedOrder = normalizeOrder(order);
  const restored = Buffer.alloc(4);

  for (let index = 0; index < normalizedOrder.length; index += 1) {
    const label = normalizedOrder[index] ?? '';
    const targetIndex = 'ABCD'.indexOf(label);
    restored[targetIndex] = bytes.readUInt8(index);
  }

  return restored;
}

export function getRegisterLength(type: RegisterType | string): 1 | 2 {
  assertType(type);
  return TYPE_LENGTHS[type];
}

export function assertRegisterWord(word: number): number {
  assertInteger(word, 'Register word');

  if (word < 0 || word > 0xffff) {
    throw new Error('Register word must be between 0 and 65535');
  }

  return word;
}

export function encodeValue({
  type,
  value,
  order = 'ABCD'
}: {
  type: RegisterType | string;
  value: number;
  order?: string;
}): number[] {
  assertType(type);

  if (type === 'uint16') {
    assertInteger(value, 'uint16 value');
    if (value < 0 || value > 0xffff) {
      throw new Error('uint16 value must be between 0 and 65535');
    }
    return [value];
  }

  if (type === 'int16') {
    assertInteger(value, 'int16 value');
    if (value < -0x8000 || value > 0x7fff) {
      throw new Error('int16 value must be between -32768 and 32767');
    }

    const buffer = Buffer.alloc(2);
    buffer.writeInt16BE(value, 0);
    return [buffer.readUInt16BE(0)];
  }

  const buffer = Buffer.alloc(4);

  if (type === 'uint32') {
    assertInteger(value, 'uint32 value');
    if (value < 0 || value > 0xffffffff) {
      throw new Error('uint32 value must be between 0 and 4294967295');
    }
    buffer.writeUInt32BE(value, 0);
  } else if (type === 'int32') {
    assertInteger(value, 'int32 value');
    if (value < -0x80000000 || value > 0x7fffffff) {
      throw new Error('int32 value must be between -2147483648 and 2147483647');
    }
    buffer.writeInt32BE(value, 0);
  } else {
    assertFiniteNumber(value, 'float32 value');
    buffer.writeFloatBE(value, 0);
  }

  const ordered = reorderBytesForEncode(buffer, order);
  return [ordered.readUInt16BE(0), ordered.readUInt16BE(2)];
}

export function decodeValue(
  type: RegisterType | string,
  registers: number[],
  order = 'ABCD'
): number {
  assertType(type);

  if (registers.length !== TYPE_LENGTHS[type]) {
    throw new Error(`Expected ${TYPE_LENGTHS[type]} registers for type "${type}"`);
  }

  const normalizedRegisters = registers.map(assertRegisterWord);

  if (type === 'uint16') {
    return normalizedRegisters[0]!;
  }

  if (type === 'int16') {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(normalizedRegisters[0]!, 0);
    return buffer.readInt16BE(0);
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(normalizedRegisters[0]!, 0);
  buffer.writeUInt16BE(normalizedRegisters[1]!, 2);

  const restored = restoreBytesForDecode(buffer, order);

  if (type === 'uint32') {
    return restored.readUInt32BE(0);
  }

  if (type === 'int32') {
    return restored.readInt32BE(0);
  }

  return restored.readFloatBE(0);
}
