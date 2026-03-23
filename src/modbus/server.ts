import net from 'node:net';
import {
  EXCEPTION_CODES,
  FUNCTION_CODES,
  buildExceptionPdu,
  buildResponseFrame,
  extractFrames,
  parseRequestFrame
} from './frame.ts';
import type { AddressInfo } from 'node:net';
import type { DeviceRequestMeta, RegisterBankName, TrafficLogEntry } from '../types.ts';
import type { DeviceRuntime } from '../core/device-runtime.ts';

interface ModbusError extends Error {
  modbusExceptionCode: number;
}

interface ModbusTcpServerOptions {
  host?: string;
  port?: number;
  devices: DeviceRuntime[];
}

function createModbusError(exceptionCode: number, message: string): ModbusError {
  const error = new Error(message);
  return Object.assign(error, { modbusExceptionCode: exceptionCode });
}

export class ModbusTcpServer {
  host: string;

  port: number;

  devices: Map<number, DeviceRuntime>;

  server: net.Server | null;

  sockets: Set<net.Socket>;

  onTraffic: ((entry: Omit<TrafficLogEntry, 'id' | 'timestamp'>) => void) | null;

  constructor(options: ModbusTcpServerOptions) {
    this.host = options.host ?? '0.0.0.0';
    this.port = options.port ?? 1502;
    this.devices = new Map<number, DeviceRuntime>(
      options.devices.map((device) => [device.unitId, device])
    );
    this.server = null;
    this.sockets = new Set<net.Socket>();
    this.onTraffic = null;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = net.createServer((socket: net.Socket) => {
      this.sockets.add(socket);
      let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      const clientAddress = socket.remoteAddress ?? null;

      socket.on('data', (chunk: Buffer) => {
        try {
          pending = Buffer.concat([pending, chunk]);
          const { frames, rest } = extractFrames(pending);
          pending = rest;

          for (const frame of frames) {
            const response = this.handleFrame(frame, clientAddress);
            if (response) {
              socket.write(response);
            }
          }
        } catch (error) {
          console.error('Error processing Modbus frame:', error);
          socket.destroy();
        }
      });

      socket.on('error', (error) => {
        console.error('Socket error:', error);
        this.sockets.delete(socket);
      });

      socket.on('close', () => {
        this.sockets.delete(socket);
      });
    });

    const server = this.server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  get address(): AddressInfo | null {
    const address = this.server?.address() ?? null;
    return address && typeof address !== 'string' ? address : null;
  }

  logTraffic(entry: Omit<TrafficLogEntry, 'id' | 'timestamp'>): void {
    this.onTraffic?.(entry);
  }

  handleFrame(frame: Buffer, clientAddress: string | null = null): Buffer | null {
    const request = parseRequestFrame(frame);

    if (request.protocolId !== 0 || request.pdu.length === 0) {
      this.logTraffic({
        protocol: 'modbus-tcp',
        method: null,
        requestTarget: null,
        clientAddress,
        deviceId: null,
        unitId: request.unitId,
        functionCode: request.pdu.readUInt8(0),
        bank: null,
        startAddress: null,
        quantity: null,
        outcome: 'invalid',
        exceptionCode: null,
        message: 'Unsupported protocol header'
      });
      return null;
    }

    const functionCode = request.pdu.readUInt8(0);
    const device = this.devices.get(request.unitId);
    const meta = this.extractRequestMeta(request.pdu);

    if (!device) {
      this.logTraffic({
        protocol: 'modbus-tcp',
        method: null,
        requestTarget: null,
        clientAddress,
        deviceId: null,
        unitId: request.unitId,
        functionCode,
        bank: meta.bank ?? null,
        startAddress: meta.startAddress ?? null,
        quantity: meta.quantity ?? null,
        outcome: 'exception',
        exceptionCode: EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS,
        message: 'Unknown unit id'
      });
      return buildResponseFrame(
        request.transactionId,
        request.unitId,
        buildExceptionPdu(functionCode, EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS)
      );
    }

    try {
      const faultExceptionCode = device.evaluateFault(meta);
      if (faultExceptionCode != null) {
        this.logTraffic({
          protocol: 'modbus-tcp',
          method: null,
          requestTarget: null,
          clientAddress,
          deviceId: device.id,
          unitId: request.unitId,
          functionCode,
          bank: meta.bank ?? null,
          startAddress: meta.startAddress ?? null,
          quantity: meta.quantity ?? null,
          outcome: 'exception',
          exceptionCode: faultExceptionCode,
          message: 'Device fault matched request'
        });
        return buildResponseFrame(
          request.transactionId,
          request.unitId,
          buildExceptionPdu(functionCode, faultExceptionCode)
        );
      }

      const responsePdu = this.executeRequest(device, request.pdu);
      this.logTraffic({
        protocol: 'modbus-tcp',
        method: null,
        requestTarget: null,
        clientAddress,
        deviceId: device.id,
        unitId: request.unitId,
        functionCode,
        bank: meta.bank ?? null,
        startAddress: meta.startAddress ?? null,
        quantity: meta.quantity ?? null,
        outcome: 'ok',
        exceptionCode: null,
        message: null
      });
      return buildResponseFrame(request.transactionId, request.unitId, responsePdu);
    } catch (error) {
      const modbusError = error as Partial<ModbusError>;
      const exceptionCode =
        modbusError.modbusExceptionCode ?? EXCEPTION_CODES.SERVER_DEVICE_FAILURE;
      this.logTraffic({
        protocol: 'modbus-tcp',
        method: null,
        requestTarget: null,
        clientAddress,
        deviceId: device.id,
        unitId: request.unitId,
        functionCode,
        bank: meta.bank ?? null,
        startAddress: meta.startAddress ?? null,
        quantity: meta.quantity ?? null,
        outcome: 'exception',
        exceptionCode,
        message: error instanceof Error ? error.message : String(error)
      });

      return buildResponseFrame(
        request.transactionId,
        request.unitId,
        buildExceptionPdu(functionCode, exceptionCode)
      );
    }
  }

  extractRequestMeta(pdu: Buffer): DeviceRequestMeta {
    const functionCode = pdu.readUInt8(0);

    if (functionCode === FUNCTION_CODES.READ_HOLDING_REGISTERS && pdu.length >= 5) {
      return {
        functionCode,
        bank: 'holding',
        startAddress: pdu.readUInt16BE(1),
        quantity: pdu.readUInt16BE(3)
      };
    }

    if (functionCode === FUNCTION_CODES.READ_INPUT_REGISTERS && pdu.length >= 5) {
      return {
        functionCode,
        bank: 'input',
        startAddress: pdu.readUInt16BE(1),
        quantity: pdu.readUInt16BE(3)
      };
    }

    if (functionCode === FUNCTION_CODES.WRITE_SINGLE_REGISTER && pdu.length >= 5) {
      return {
        functionCode,
        bank: 'holding',
        startAddress: pdu.readUInt16BE(1),
        quantity: 1
      };
    }

    if (functionCode === FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS && pdu.length >= 5) {
      return {
        functionCode,
        bank: 'holding',
        startAddress: pdu.readUInt16BE(1),
        quantity: pdu.readUInt16BE(3)
      };
    }

    return {
      functionCode
    };
  }

  executeRequest(device: DeviceRuntime, pdu: Buffer): Buffer {
    const functionCode = pdu.readUInt8(0);

    switch (functionCode) {
      case FUNCTION_CODES.READ_HOLDING_REGISTERS:
        return this.handleRead(device, pdu, 'holding');
      case FUNCTION_CODES.READ_INPUT_REGISTERS:
        return this.handleRead(device, pdu, 'input');
      case FUNCTION_CODES.WRITE_SINGLE_REGISTER:
        return this.handleWriteSingle(device, pdu);
      case FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS:
        return this.handleWriteMultiple(device, pdu);
      default:
        throw createModbusError(
          EXCEPTION_CODES.ILLEGAL_FUNCTION,
          `Unsupported function code ${functionCode}`
        );
    }
  }

  handleRead(device: DeviceRuntime, pdu: Buffer, bank: RegisterBankName): Buffer {
    if (pdu.length !== 5) {
      throw createModbusError(EXCEPTION_CODES.ILLEGAL_DATA_VALUE, 'Malformed read request');
    }

    const functionCode = pdu.readUInt8(0);
    const startAddress = pdu.readUInt16BE(1);
    const quantity = pdu.readUInt16BE(3);

    if (quantity < 1 || quantity > 125) {
      throw createModbusError(EXCEPTION_CODES.ILLEGAL_DATA_VALUE, 'Invalid read quantity');
    }

    try {
      const values =
        bank === 'holding'
          ? device.readHolding(startAddress, quantity)
          : device.readInput(startAddress, quantity);

      const response = Buffer.alloc(2 + values.length * 2);
      response.writeUInt8(functionCode, 0);
      response.writeUInt8(values.length * 2, 1);
      values.forEach((value, index) => {
        response.writeUInt16BE(value, 2 + index * 2);
      });
      return response;
    } catch (error) {
      throw createModbusError(
        EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  handleWriteSingle(device: DeviceRuntime, pdu: Buffer): Buffer {
    if (pdu.length !== 5) {
      throw createModbusError(
        EXCEPTION_CODES.ILLEGAL_DATA_VALUE,
        'Malformed write single request'
      );
    }

    const address = pdu.readUInt16BE(1);
    const value = pdu.readUInt16BE(3);

    try {
      device.writeHolding(address, [value]);
    } catch (error) {
      throw createModbusError(
        EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS,
        error instanceof Error ? error.message : String(error)
      );
    }

    return Buffer.from(pdu);
  }

  handleWriteMultiple(device: DeviceRuntime, pdu: Buffer): Buffer {
    if (pdu.length < 6) {
      throw createModbusError(
        EXCEPTION_CODES.ILLEGAL_DATA_VALUE,
        'Malformed write multiple request'
      );
    }

    const functionCode = pdu.readUInt8(0);
    const address = pdu.readUInt16BE(1);
    const quantity = pdu.readUInt16BE(3);
    const byteCount = pdu.readUInt8(5);

    if (quantity < 1 || quantity > 123) {
      throw createModbusError(EXCEPTION_CODES.ILLEGAL_DATA_VALUE, 'Invalid write quantity');
    }

    if (byteCount !== quantity * 2 || pdu.length !== 6 + byteCount) {
      throw createModbusError(
        EXCEPTION_CODES.ILLEGAL_DATA_VALUE,
        'Write multiple payload size mismatch'
      );
    }

    const values: number[] = [];
    for (let index = 0; index < quantity; index += 1) {
      values.push(pdu.readUInt16BE(6 + index * 2));
    }

    try {
      device.writeHolding(address, values);
    } catch (error) {
      throw createModbusError(
        EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS,
        error instanceof Error ? error.message : String(error)
      );
    }

    const response = Buffer.alloc(5);
    response.writeUInt8(functionCode, 0);
    response.writeUInt16BE(address, 1);
    response.writeUInt16BE(quantity, 3);
    return response;
  }
}
