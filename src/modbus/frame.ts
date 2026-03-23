import type { ModbusRequestFrame } from '../types.ts';

export const FUNCTION_CODES = Object.freeze({
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_REGISTERS: 0x10
});

export const EXCEPTION_CODES = Object.freeze({
  ILLEGAL_FUNCTION: 0x01,
  ILLEGAL_DATA_ADDRESS: 0x02,
  ILLEGAL_DATA_VALUE: 0x03,
  SERVER_DEVICE_FAILURE: 0x04
});

export function buildExceptionPdu(functionCode: number, exceptionCode: number): Buffer {
  return Buffer.from([functionCode | 0x80, exceptionCode]);
}

export function buildResponseFrame(
  transactionId: number,
  unitId: number,
  pdu: Buffer
): Buffer {
  const header = Buffer.alloc(7);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(pdu.length + 1, 4);
  header.writeUInt8(unitId, 6);
  return Buffer.concat([header, pdu]);
}

export function extractFrames(buffer: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;

  while (buffer.length - offset >= 7) {
    const length = buffer.readUInt16BE(offset + 4);
    const totalLength = 6 + length;

    if (buffer.length - offset < totalLength) {
      break;
    }

    frames.push(buffer.subarray(offset, offset + totalLength));
    offset += totalLength;
  }

  return {
    frames,
    rest: buffer.subarray(offset)
  };
}

export function parseRequestFrame(frame: Buffer): ModbusRequestFrame {
  if (frame.length < 8) {
    throw new Error('Modbus TCP frame is too short');
  }

  return {
    transactionId: frame.readUInt16BE(0),
    protocolId: frame.readUInt16BE(2),
    length: frame.readUInt16BE(4),
    unitId: frame.readUInt8(6),
    pdu: frame.subarray(7)
  };
}
