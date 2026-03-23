import net from 'node:net';

interface RequestOptions {
  transactionId?: number;
  unitId?: number;
  functionCode: number;
  payload?: Buffer;
}

interface ParsedResponse {
  transactionId: number;
  protocolId: number;
  unitId: number;
  functionCode: number;
  payload: Buffer;
}

export function buildRequest({
  transactionId = 1,
  unitId = 1,
  functionCode,
  payload
}: RequestOptions): Buffer {
  const pdu = Buffer.concat([Buffer.from([functionCode]), payload ?? Buffer.alloc(0)]);
  const frame = Buffer.alloc(7 + pdu.length);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(pdu.length + 1, 4);
  frame.writeUInt8(unitId, 6);
  pdu.copy(frame, 7);
  return frame;
}

export function parseResponse(frame: Buffer): ParsedResponse {
  return {
    transactionId: frame.readUInt16BE(0),
    protocolId: frame.readUInt16BE(2),
    unitId: frame.readUInt8(6),
    functionCode: frame.readUInt8(7),
    payload: frame.subarray(8)
  };
}

export async function sendModbusRequest({
  host,
  port,
  transactionId,
  unitId,
  functionCode,
  payload
}: {
  host: string;
  port: number;
  transactionId?: number;
  unitId?: number;
  functionCode: number;
  payload?: Buffer;
}): Promise<ParsedResponse> {
  return new Promise<ParsedResponse>((resolve, reject) => {
    const socket = net.connect({ host, port });
    let pending = Buffer.alloc(0);

    socket.on('connect', () => {
      socket.write(
        buildRequest({
          transactionId,
          unitId,
          functionCode,
          payload
        })
      );
    });

    socket.on('data', (chunk) => {
      const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      pending = Buffer.concat([pending, normalizedChunk]);

      if (pending.length >= 7) {
        const totalLength = 6 + pending.readUInt16BE(4);
        if (pending.length >= totalLength) {
          const frame = pending.subarray(0, totalLength);
          socket.end();
          resolve(parseResponse(frame));
        }
      }
    });

    socket.on('error', reject);
  });
}
