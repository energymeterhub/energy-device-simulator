import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DeviceRuntime } from '../core/device-runtime.ts';
import type { TrafficLogEntry } from '../types.ts';
import {
  buildShellyEmeterReading,
  buildShellyIdentityPayload,
  buildShellyRelayPayload,
  buildShellySettingsEmeterPayload,
  buildShellySettingsPayload,
  buildShellySettingsRelayPayload,
  buildShellyStatusPayload,
  resetShellyEnergyTotals
} from '../protocols/shelly-gen1.ts';

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

export class ShellyGen1HttpServer {
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

  private setRelayState(isOn: boolean): void {
    this.device.setEntryValue('holding', 100, isOn ? 1 : 0, {
      force: true
    });
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const baseUrl = `http://${request.headers.host ?? '127.0.0.1'}`;
    const url = new URL(request.url ?? '/', baseUrl);

    if (request.method !== 'GET' && request.method !== 'POST') {
      this.logTraffic(request, 'invalid', 'Unsupported method');
      json(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/shelly') {
      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellyIdentityPayload(this.device));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/settings') {
      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellySettingsPayload(this.device));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/settings/login') {
      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellySettingsPayload(this.device).login);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/settings/relay/0') {
      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellySettingsRelayPayload(this.device));
      return;
    }

    const emeterSettingsMatch = url.pathname.match(/^\/settings\/emeter\/(\d+)$/);
    if (request.method === 'GET' && emeterSettingsMatch) {
      const index = Number(emeterSettingsMatch[1]);
      if (!Number.isInteger(index) || index < 0 || index > 2) {
        this.logTraffic(request, 'invalid', 'Unknown emeter index');
        json(response, 404, { error: 'Not found' });
        return;
      }

      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellySettingsEmeterPayload(index));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellyStatusPayload(this.device));
      return;
    }

    const emeterMatch = url.pathname.match(/^\/emeter\/(\d+)$/);
    if (request.method === 'GET' && emeterMatch) {
      const index = Number(emeterMatch[1]);
      if (!Number.isInteger(index) || index < 0 || index > 2) {
        this.logTraffic(request, 'invalid', 'Unknown emeter index');
        json(response, 404, { error: 'Not found' });
        return;
      }

      this.logTraffic(request, 'ok', null);
      if (url.searchParams.has('reset_totals')) {
        resetShellyEnergyTotals(this.device, [index as 0 | 1 | 2]);
      }
      json(response, 200, buildShellyEmeterReading(this.device, index));
      return;
    }

    if (url.pathname === '/relay/0') {
      const turn = url.searchParams.get('turn');
      if (turn === 'on') {
        this.setRelayState(true);
      } else if (turn === 'off') {
        this.setRelayState(false);
      }

      this.logTraffic(request, 'ok', null);
      json(response, 200, buildShellyRelayPayload(this.device));
      return;
    }

    if ((request.method === 'POST' || request.method === 'GET') && url.pathname === '/reset_data') {
      resetShellyEnergyTotals(this.device);

      this.logTraffic(request, 'ok', null);
      json(response, 200, { reset_data: 1 });
      return;
    }

    this.logTraffic(request, 'invalid', 'Unknown path');
    json(response, 404, { error: 'Not found' });
  }
}
