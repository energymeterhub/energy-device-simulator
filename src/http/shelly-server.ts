import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DeviceRuntime } from '../core/device-runtime.ts';
import type { TrafficLogEntry } from '../types.ts';
import {
  buildShellyPro3emRpcEmDataStatus,
  buildShellyPro3emRpcEmStatus
} from '../protocols/shelly-pro3em-rpc.ts';

interface ShellyServerOptions {
  device: DeviceRuntime;
  host?: string;
  port?: number;
}

function json(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload, null, 2));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRpcInstanceZero(url: URL): boolean {
  return url.searchParams.get('id') === '0';
}

export class ShellyRpcHttpServer {
  device: DeviceRuntime;

  host: string;

  port: number;

  server: http.Server | null;

  onTraffic: ((entry: Omit<TrafficLogEntry, 'id' | 'timestamp'>) => void) | null;

  constructor(options: ShellyServerOptions) {
    this.device = options.device;
    this.host = options.host ?? options.device.host;
    this.port = options.port ?? options.device.port;
    this.server = null;
    this.onTraffic = null;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
      this.handleRequest(request, response).catch((error) => {
        this.logTraffic(request, 'exception', getErrorMessage(error));
        json(response, 500, {
          error: getErrorMessage(error)
        });
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

  private logTraffic(
    request: IncomingMessage,
    outcome: TrafficLogEntry['outcome'],
    message: string | null
  ): void {
    const clientAddress = request.socket.remoteAddress ?? null;
    const requestTarget = (() => {
      try {
        const baseUrl = `http://${request.headers.host ?? '127.0.0.1'}`;
        const url = new URL(request.url ?? '/', baseUrl);
        return `${url.pathname}${url.search}`;
      } catch {
        return request.url ?? null;
      }
    })();

    this.onTraffic?.({
      protocol: 'http',
      method: request.method ?? null,
      requestTarget,
      clientAddress,
      deviceId: this.device.id,
      unitId: this.device.unitId,
      functionCode: null,
      bank: null,
      startAddress: null,
      quantity: null,
      outcome,
      exceptionCode: null,
      message
    });
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const baseUrl = `http://${request.headers.host ?? '127.0.0.1'}`;
    const url = new URL(request.url ?? '/', baseUrl);

    if (request.method !== 'GET') {
      this.logTraffic(request, 'invalid', 'Unsupported method');
      json(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (url.pathname === '/rpc/EM.GetStatus' && isRpcInstanceZero(url)) {
      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellyPro3emRpcEmStatus(this.device));
      return;
    }

    if (url.pathname === '/rpc/EMData.GetStatus' && isRpcInstanceZero(url)) {
      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellyPro3emRpcEmDataStatus(this.device));
      return;
    }

    this.logTraffic(request, 'invalid', 'Unknown path');
    json(response, 404, { error: 'Not found' });
  }
}
