export type RegisterType = 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32';

export type RegisterBankName = 'holding' | 'input';

export type DeviceTransport = 'modbus-tcp' | 'shelly-rpc-http';

export type TrafficProtocol = 'modbus-tcp' | 'http';

export type BehaviorMode = 'normal' | 'paused';

export interface RegisterEntryObjectInput {
  name?: string | null;
  description?: string | null;
  type?: RegisterType;
  value?: number;
  writable?: boolean;
  order?: string;
}

export type RegisterEntryInput = number | RegisterEntryObjectInput;

export type RegisterMapDefinition = Record<string, RegisterEntryInput>;

export interface DeviceRegistersDefinition {
  holding?: RegisterMapDefinition;
  input?: RegisterMapDefinition;
}

export interface RandomWalkBehavior {
  type: 'randomWalk';
  id?: string;
  bank?: RegisterBankName;
  address: number;
  intervalMs?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface SineWaveBehavior {
  type: 'sineWave';
  id?: string;
  bank?: RegisterBankName;
  address: number;
  intervalMs?: number;
  min?: number;
  max?: number;
  periodMs?: number;
}

export type TriggerRoundingMode = 'none' | 'round' | 'floor' | 'ceil';

export interface ValueFromWrittenConfig {
  source: 'writtenValue';
  multiply?: number;
  offset?: number;
  min?: number;
  max?: number;
  round?: TriggerRoundingMode;
}

export interface SetEntryValueAction {
  kind: 'setEntryValue';
  bank: RegisterBankName;
  address: number;
  value?: number;
  fromWritten?: ValueFromWrittenConfig;
  force?: boolean;
}

export interface SetRawRegistersAction {
  kind: 'setRawRegisters';
  bank: RegisterBankName;
  address: number;
  values: number[];
  force?: boolean;
}

export type DeviceAction = SetEntryValueAction | SetRawRegistersAction;

export interface OnWriteTriggerBehavior {
  type: 'onWriteTrigger';
  id?: string;
  bank?: RegisterBankName;
  address: number;
  actions: DeviceAction[];
}

export type TimedBehavior = RandomWalkBehavior | SineWaveBehavior;

export type DeviceBehavior = TimedBehavior | OnWriteTriggerBehavior;

export interface OfflineFault {
  id: string;
  type: 'offline';
  enabled?: boolean;
  exceptionCode?: number;
  message?: string;
}

export interface FreezeFault {
  id: string;
  type: 'freeze';
  enabled?: boolean;
  message?: string;
}

export interface ExceptionFault {
  id: string;
  type: 'exception';
  enabled?: boolean;
  exceptionCode: number;
  functionCodes?: number[];
  bank?: RegisterBankName;
  startAddress?: number;
  endAddress?: number;
  message?: string;
}

export type DeviceFault = OfflineFault | FreezeFault | ExceptionFault;

export interface DeviceScenarioPatch {
  deviceId: string;
  behaviorMode?: BehaviorMode;
  entryValues?: SetEntryValueAction[];
  rawWrites?: SetRawRegistersAction[];
  faults?: DeviceFault[];
  clearFaults?: boolean;
}

export interface ScenarioDefinition {
  id: string;
  name?: string;
  description?: string;
  patches: DeviceScenarioPatch[];
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string | null;
  patchCount: number;
}

export interface DeviceProfileMetadata {
  id: string;
  title: string;
  description: string;
  manufacturerId: string;
  manufacturerName: string;
  productId: string;
  productName: string;
  transport: DeviceTransport;
  defaultPort: number;
  compatibility: 'generic' | 'vendor-compat' | 'vendor-example';
  notes?: string[];
}

export interface DeviceConfigInput {
  id: string;
  profile?: string;
  name?: string;
  kind?: string;
  model?: string;
  transport?: DeviceTransport;
  host?: string;
  port?: number;
  unitId?: number;
  registers?: DeviceRegistersDefinition;
  behaviors?: DeviceBehavior[];
}

export interface DeviceProfileDefinition extends DeviceProfileMetadata {
  device: Omit<DeviceConfigInput, 'id' | 'port'> & { port?: number };
}

export interface DeviceConfig extends DeviceConfigInput {
  profileId: string | null;
  name: string;
  kind: string;
  model: string;
  transport?: DeviceTransport;
  host: string;
  port: number;
  unitId: number;
  registers: DeviceRegistersDefinition;
  behaviors: DeviceBehavior[];
}

export interface ControlApiConfig {
  enabled: boolean;
  host: string;
  port: number;
}

export interface SimulatorConfig {
  behaviorTickMs: number;
  controlApi: ControlApiConfig;
  devices: DeviceConfig[];
  scenarios: ScenarioDefinition[];
  activeScenarioId: string | null;
}

export interface NormalizedRegisterEntry {
  name: string | null;
  description: string | null;
  type: RegisterType;
  value: number;
  writable: boolean;
  order: string;
  bank: RegisterBankName;
  address: number;
  length: number;
}

export interface RegisterEntrySnapshot extends NormalizedRegisterEntry {
  value: number;
  registers: number[];
}

export type RawRegisterDump = Record<string, number>;

export interface DeviceSummary {
  id: string;
  profileId: string | null;
  name: string;
  kind: string;
  model: string;
  transport: DeviceTransport;
  host: string;
  port: number;
  configuredPort: number;
  unitId: number;
  behaviorCount: number;
  behaviorMode: BehaviorMode;
  activeFaultCount: number;
  currentScenario: string | null;
}

export interface DeviceSnapshot extends DeviceSummary {
  registers: Record<RegisterBankName, RegisterEntrySnapshot[]>;
  raw: Record<RegisterBankName, RawRegisterDump>;
  faults: DeviceFault[];
}

export interface ModbusRequestFrame {
  transactionId: number;
  protocolId: number;
  length: number;
  unitId: number;
  pdu: Buffer;
}

export interface DeviceRequestMeta {
  functionCode: number;
  bank?: RegisterBankName;
  startAddress?: number;
  quantity?: number;
}

export interface TrafficLogEntry {
  id: number;
  timestamp: string;
  protocol: TrafficProtocol;
  method: string | null;
  requestTarget: string | null;
  clientAddress: string | null;
  deviceId: string | null;
  unitId: number;
  functionCode: number | null;
  bank: RegisterBankName | null;
  startAddress: number | null;
  quantity: number | null;
  outcome: 'ok' | 'exception' | 'invalid';
  exceptionCode: number | null;
  message: string | null;
}

export interface ProtocolPreviewRow {
  label: string;
  value: string;
  note?: string | null;
}

export interface ProtocolPreviewSection {
  id: string;
  title: string;
  description?: string;
  kind: 'table' | 'json' | 'register-block' | 'text';
  endpoint?: string;
  method?: string;
  rows?: ProtocolPreviewRow[];
  payload?: unknown;
  bank?: RegisterBankName;
  functionCode?: number;
  startAddress?: number;
  quantity?: number;
  words?: number[];
  lines?: string[];
}

export interface ProtocolPreview {
  title: string;
  summary: string;
  transport: DeviceTransport;
  connection: ProtocolPreviewRow[];
  sections: ProtocolPreviewSection[];
  debugHints: string[];
}

export interface DashboardPayload {
  health: {
    status: 'ok';
    devices: number;
    activeScenarioId: string | null;
  };
  device: DeviceSummary | null;
  snapshot: DeviceSnapshot | null;
  profile: DeviceProfileMetadata | null;
  protocolPreview: ProtocolPreview | null;
  profiles: DeviceProfileMetadata[];
  scenarios: ScenarioSummary[];
  traffic: TrafficLogEntry[];
}
