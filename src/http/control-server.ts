import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DeviceFault,
  RegisterBankName,
  SetEntryValueAction,
  SetRawRegistersAction
} from '../types.ts';
import type { SimulatorApp } from '../app/simulator-app.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.resolve(__dirname, './static');

const STATIC_ASSETS: Record<string, { file: string; contentType: string }> = {
  '/': {
    file: 'index.html',
    contentType: 'text/html; charset=utf-8'
  },
  '/overview': {
    file: 'index.html',
    contentType: 'text/html; charset=utf-8'
  },
  '/registers': {
    file: 'index.html',
    contentType: 'text/html; charset=utf-8'
  },
  '/control': {
    file: 'index.html',
    contentType: 'text/html; charset=utf-8'
  },
  '/traffic': {
    file: 'index.html',
    contentType: 'text/html; charset=utf-8'
  },
  '/app.css': {
    file: 'app.css',
    contentType: 'text/css; charset=utf-8'
  },
  '/app.js': {
    file: 'app.js',
    contentType: 'application/javascript; charset=utf-8'
  },
  '/favicon.svg': {
    file: 'favicon.svg',
    contentType: 'image/svg+xml'
  }
};

function json(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload, null, 2));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function badRequest(response: ServerResponse, message: string): void {
  json(response, 400, { error: message });
}

function normalizeOptionalString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number, label: string): number {
  if (value == null || value === '') {
    return fallback;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return numericValue;
}

async function serveStaticAsset(
  response: ServerResponse,
  pathname: string
): Promise<boolean> {
  const asset = STATIC_ASSETS[pathname];
  if (!asset) {
    return false;
  }

  const body = await readFile(path.join(STATIC_DIR, asset.file));
  response.writeHead(200, {
    'Content-Type': asset.contentType,
    'Cache-Control': 'no-store'
  });
  response.end(body);
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += normalizedChunk.length;
    if (size > 1024 * 1024) {
      throw new Error('Request body too large');
    }
    chunks.push(normalizedChunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object');
  }

  return parsed as Record<string, unknown>;
}

function normalizeBank(value: unknown): RegisterBankName {
  return value === 'input' ? 'input' : 'holding';
}

function toSetEntryAction(body: Record<string, unknown>): SetEntryValueAction {
  return {
    kind: 'setEntryValue',
    bank: normalizeBank(body.bank),
    address: Number(body.address),
    value: Number(body.value),
    force: body.force === true
  };
}

function toRawWriteAction(body: Record<string, unknown>): SetRawRegistersAction {
  return {
    kind: 'setRawRegisters',
    bank: normalizeBank(body.bank),
    address: Number(body.address),
    values: Array.isArray(body.values) ? body.values.map((value) => Number(value)) : [Number(body.value)],
    force: body.force === true
  };
}

function toFault(body: Record<string, unknown>): DeviceFault {
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error('Fault id is required');
  }

  if (body.type === 'offline') {
    return {
      id: body.id,
      type: 'offline',
      enabled: body.enabled !== false,
      exceptionCode:
        body.exceptionCode == null ? undefined : Number(body.exceptionCode),
      message: typeof body.message === 'string' ? body.message : undefined
    };
  }

  if (body.type === 'freeze') {
    return {
      id: body.id,
      type: 'freeze',
      enabled: body.enabled !== false,
      message: typeof body.message === 'string' ? body.message : undefined
    };
  }

  if (body.type === 'exception') {
    return {
      id: body.id,
      type: 'exception',
      enabled: body.enabled !== false,
      exceptionCode: Number(body.exceptionCode),
      functionCodes: Array.isArray(body.functionCodes)
        ? body.functionCodes.map((value) => Number(value))
        : undefined,
      bank: body.bank == null ? undefined : normalizeBank(body.bank),
      startAddress: body.startAddress == null ? undefined : Number(body.startAddress),
      endAddress: body.endAddress == null ? undefined : Number(body.endAddress),
      message: typeof body.message === 'string' ? body.message : undefined
    };
  }

  throw new Error('Fault type must be offline, freeze, or exception');
}

export class ControlServer {
  app: SimulatorApp;

  host: string;

  port: number;

  server: http.Server | null;

  constructor(options: { app: SimulatorApp; host?: string; port?: number }) {
    this.app = options.app;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.server = null;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
      this.handleRequest(request, response).catch((error) => {
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

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const baseUrl = `http://${request.headers.host ?? '127.0.0.1'}`;
    const url = new URL(request.url ?? '/', baseUrl);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    if (request.method === 'GET' && (await serveStaticAsset(response, url.pathname))) {
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, {
        status: 'ok',
        devices: this.app.listDevices().length,
        activeScenarioId: this.app.getActiveScenarioId()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/dashboard') {
      json(response, 200, this.app.getDashboard());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/traffic') {
      json(response, 200, {
        traffic: this.app.listTraffic()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/devices') {
      json(response, 200, {
        devices: this.app.listDevices()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/profiles') {
      json(response, 200, {
        profiles: this.app.listProfiles()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/scenarios') {
      json(response, 200, {
        activeScenarioId: this.app.getActiveScenarioId(),
        scenarios: this.app.listScenarios()
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/scenarios/apply') {
      const body = await readJsonBody(request);
      if (typeof body.id !== 'string' || body.id.length === 0) {
        badRequest(response, 'Scenario id is required');
        return;
      }

      this.app.applyScenario(body.id);
      json(response, 200, {
        ok: true,
        activeScenarioId: this.app.getActiveScenarioId()
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/scenarios/reset') {
      this.app.clearScenario();
      json(response, 200, {
        ok: true,
        activeScenarioId: this.app.getActiveScenarioId()
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/device/switch') {
      const body = await readJsonBody(request);
      const profileId =
        typeof body.productId === 'string' && body.productId.trim().length > 0
          ? body.productId.trim()
          : typeof body.profileId === 'string' && body.profileId.trim().length > 0
            ? body.profileId.trim()
            : null;

      if (!profileId) {
        badRequest(response, 'productId is required');
        return;
      }

      const device = await this.app.switchDeviceProfile({
        profileId,
        host: normalizeOptionalString(body.host, '0.0.0.0'),
        port: body.port == null || body.port === '' ? undefined : normalizePositiveInteger(body.port, 502, 'port'),
        unitId: normalizePositiveInteger(body.unitId, 1, 'unitId')
      });
      json(response, 200, {
        ok: true,
        device
      });
      return;
    }

    if (pathSegments[0] !== 'api' || pathSegments[1] !== 'devices' || !pathSegments[2]) {
      json(response, 404, { error: 'Not found' });
      return;
    }

    const deviceId = pathSegments[2];
    const device = this.app.getDevice(deviceId);

    if (!device) {
      json(response, 404, { error: `Unknown device "${deviceId}"` });
      return;
    }

    if (request.method === 'GET' && pathSegments.length === 3) {
      json(response, 200, device.getSummary());
      return;
    }

    if (
      request.method === 'GET' &&
      pathSegments.length === 4 &&
      pathSegments[3] === 'registers'
    ) {
      json(response, 200, device.getSnapshot());
      return;
    }

    if (
      request.method === 'GET' &&
      pathSegments.length === 4 &&
      pathSegments[3] === 'faults'
    ) {
      json(response, 200, {
        faults: device.listFaults()
      });
      return;
    }

    if (
      request.method === 'POST' &&
      pathSegments.length === 4 &&
      pathSegments[3] === 'reset'
    ) {
      this.app.resetDevice(deviceId);
      json(response, 200, {
        ok: true,
        device: device.getSummary()
      });
      return;
    }

    if (
      request.method === 'POST' &&
      pathSegments.length === 5 &&
      pathSegments[3] === 'entries' &&
      pathSegments[4] === 'set'
    ) {
      const body = await readJsonBody(request);
      const action = toSetEntryAction(body);
      device.setEntryValue(action.bank, action.address, action.value ?? 0, {
        force: action.force === true
      });
      json(response, 200, {
        ok: true,
        entry: {
          bank: action.bank,
          address: action.address,
          value: device.getEntryValue(action.bank, action.address)
        }
      });
      return;
    }

    if (
      request.method === 'POST' &&
      pathSegments.length === 5 &&
      pathSegments[3] === 'registers' &&
      pathSegments[4] === 'write'
    ) {
      const body = await readJsonBody(request);
      const action = toRawWriteAction(body);
      device.setRawRegisters(action.bank, action.address, action.values, {
        force: action.force === true
      });
      json(response, 200, {
        ok: true,
        raw: device.getSnapshot().raw[action.bank]
      });
      return;
    }

    if (
      request.method === 'POST' &&
      pathSegments.length === 5 &&
      pathSegments[3] === 'faults' &&
      pathSegments[4] === 'apply'
    ) {
      const body = await readJsonBody(request);
      this.app.applyDeviceFault(deviceId, toFault(body));
      json(response, 200, {
        ok: true,
        faults: device.listFaults()
      });
      return;
    }

    if (
      request.method === 'POST' &&
      pathSegments.length === 5 &&
      pathSegments[3] === 'faults' &&
      pathSegments[4] === 'clear'
    ) {
      const body = await readJsonBody(request);
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((value): value is string => typeof value === 'string')
        : undefined;
      this.app.clearDeviceFaults(deviceId, ids);
      json(response, 200, {
        ok: true,
        faults: device.listFaults()
      });
      return;
    }

    json(response, 404, { error: 'Not found' });
  }
}
