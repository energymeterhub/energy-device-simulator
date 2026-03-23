import net from 'node:net';
import { decodeValue, getRegisterLength } from '../core/register-codec.ts';
import { FUNCTION_CODES, extractFrames, parseRequestFrame } from './frame.ts';
import type { RegisterBankName, RegisterType } from '../types.ts';

export interface ModbusTcpClientOptions {
  host: string;
  port: number;
  unitId?: number;
  timeoutMs?: number;
}

export interface ReadValueOptions {
  bank: RegisterBankName;
  address: number;
  type: RegisterType;
  order?: string;
}

export class ModbusClientError extends Error {}

export class ModbusExceptionError extends ModbusClientError {
  functionCode: number;

  exceptionCode: number;

  constructor(functionCode: number, exceptionCode: number) {
    super(
      `Modbus exception response for function 0x${functionCode.toString(16)}: code 0x${exceptionCode.toString(16)}`
    );
    this.name = 'ModbusExceptionError';
    this.functionCode = functionCode;
    this.exceptionCode = exceptionCode;
  }
}

export class ModbusTcpClient {
  host: string;

  port: number;

  unitId: number;

  timeoutMs: number;

  transactionId: number;

  constructor(options: ModbusTcpClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.unitId = options.unitId ?? 1;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.transactionId = 1;
  }

  nextTransactionId(): number {
    const transactionId = this.transactionId;
    this.transactionId = this.transactionId >= 0xffff ? 1 : this.transactionId + 1;
    return transactionId;
  }

  buildRequest(functionCode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
    const transactionId = this.nextTransactionId();
    const pdu = Buffer.concat([Buffer.from([functionCode]), payload]);
    const frame = Buffer.alloc(7 + pdu.length);

    frame.writeUInt16BE(transactionId, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(pdu.length + 1, 4);
    frame.writeUInt8(this.unitId, 6);
    pdu.copy(frame, 7);

    return frame;
  }

  async request(functionCode: number, payload: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    const requestFrame = this.buildRequest(functionCode, payload);

    return new Promise<Buffer>((resolve, reject) => {
      const socket = net.connect({
        host: this.host,
        port: this.port
      });

      let pending = Buffer.alloc(0);
      let settled = false;

      const settle = (handler: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        handler();
      };

      const timeout = setTimeout(() => {
        settle(() => {
          reject(
            new ModbusClientError(
              `Modbus request timed out after ${this.timeoutMs}ms`
            )
          );
        });
      }, this.timeoutMs);

      socket.on('connect', () => {
        socket.write(requestFrame);
      });

      socket.on('data', (chunk) => {
        const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        pending = Buffer.concat([pending, normalizedChunk]);
        const { frames } = extractFrames(pending);

        if (frames.length === 0) {
          return;
        }

        settle(() => {
          try {
            const responseFrame = parseRequestFrame(frames[0]!);
            if (responseFrame.protocolId !== 0) {
              throw new ModbusClientError('Unexpected Modbus protocol id in response');
            }

            if (responseFrame.unitId !== this.unitId) {
              throw new ModbusClientError(
                `Unexpected unit id ${responseFrame.unitId} in response`
              );
            }

            if (responseFrame.pdu.length === 0) {
              throw new ModbusClientError('Empty Modbus response PDU');
            }

            const responseFunctionCode = responseFrame.pdu.readUInt8(0);
            const responsePayload = responseFrame.pdu.subarray(1);

            if (responseFunctionCode === (functionCode | 0x80)) {
              throw new ModbusExceptionError(
                functionCode,
                responsePayload.readUInt8(0) ?? 0
              );
            }

            if (responseFunctionCode !== functionCode) {
              throw new ModbusClientError(
                `Unexpected function code 0x${responseFunctionCode.toString(16)}`
              );
            }

            resolve(responsePayload);
          } catch (error) {
            reject(error);
          }
        });
      });

      socket.on('error', (error) => {
        settle(() => {
          reject(error);
        });
      });
    });
  }

  async readHoldingRegisters(startAddress: number, quantity: number): Promise<number[]> {
    return this.readRegisters('holding', startAddress, quantity);
  }

  async readInputRegisters(startAddress: number, quantity: number): Promise<number[]> {
    return this.readRegisters('input', startAddress, quantity);
  }

  async readRegisters(
    bank: RegisterBankName,
    startAddress: number,
    quantity: number
  ): Promise<number[]> {
    if (!Number.isInteger(startAddress) || startAddress < 0) {
      throw new ModbusClientError('startAddress must be a non-negative integer');
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 125) {
      throw new ModbusClientError('quantity must be an integer between 1 and 125');
    }

    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(startAddress, 0);
    payload.writeUInt16BE(quantity, 2);

    const functionCode =
      bank === 'holding'
        ? FUNCTION_CODES.READ_HOLDING_REGISTERS
        : FUNCTION_CODES.READ_INPUT_REGISTERS;

    const responsePayload = await this.request(functionCode, payload);
    const byteCount = responsePayload.readUInt8(0);

    if (byteCount !== quantity * 2 || responsePayload.length !== byteCount + 1) {
      throw new ModbusClientError('Malformed Modbus read response payload');
    }

    const values: number[] = [];
    for (let index = 0; index < quantity; index += 1) {
      values.push(responsePayload.readUInt16BE(1 + index * 2));
    }

    return values;
  }

  async readValue(options: ReadValueOptions): Promise<number> {
    const quantity = getRegisterLength(options.type);
    const values = await this.readRegisters(options.bank, options.address, quantity);
    return decodeValue(options.type, values, options.order);
  }

  async writeSingleRegister(address: number, value: number): Promise<void> {
    if (!Number.isInteger(address) || address < 0) {
      throw new ModbusClientError('address must be a non-negative integer');
    }

    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new ModbusClientError('value must be an integer between 0 and 65535');
    }

    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(address, 0);
    payload.writeUInt16BE(value, 2);

    await this.request(FUNCTION_CODES.WRITE_SINGLE_REGISTER, payload);
  }
}
