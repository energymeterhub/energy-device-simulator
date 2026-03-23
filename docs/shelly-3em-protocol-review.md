# Shelly 3EM Protocol Review

## Scope

This note reviews the current Shelly 3EM implementation in `energy-device-simulator` and checks whether the simulator is handling the device with the correct transport and payload shape.

The review covers:

- project structure and the current Shelly 3EM profile
- whether Shelly 3EM should be treated as a Modbus TCP device
- whether the simulated local API shape matches official Shelly Gen1 documentation

## Current Project Design

The simulator currently has two different device transport paths:

- `modbus-tcp`
- `shelly-gen1-http`

Relevant code paths:

- `src/profiles/builtin.ts`
- `src/app/simulator-app.ts`
- `src/http/shelly-server.ts`
- `src/modbus/server.ts`

### Shelly 3EM profile

The built-in `shelly-3em` profile is explicitly defined as:

- `transport: "shelly-gen1-http"`
- `defaultPort: 80`
- device model `SHEM-3`

The profile notes also already state:

- local API transport is HTTP
- it is not Modbus TCP

This is implemented in `src/profiles/builtin.ts`.

### Runtime routing

At runtime the simulator starts Modbus listeners only for devices whose `transport` is `modbus-tcp`.
Shelly listeners are started separately for devices whose `transport` is `shelly-gen1-http`.

This behavior is implemented in `src/app/simulator-app.ts`.

## Conclusion On Modbus TCP

### Short answer

For Shelly 3EM, the current transport decision is correct:

- the simulator does **not** expose Shelly 3EM through the Modbus TCP server
- the simulator exposes Shelly 3EM through a Gen1-style HTTP server instead

### Why

Based on official Shelly sources, Shelly 3EM is documented under the Gen1 HTTP API, not under Shelly Modbus support.

Official evidence:

- the Shelly Gen1 API reference contains dedicated Shelly 3EM endpoints such as `/status`, `/relay/0`, `/emeter/{index}`, `/settings/emeter/{index}`, and `/reset_data`
- Shelly's Modbus support article says the new-generation EM devices that support Modbus are `ProEM`, `Pro3EM`, `ProEM-400`, and `Pro3EM3CT63`

Inference from the official sources:

- Shelly 3EM should be modeled as a Gen1 HTTP device
- Shelly 3EM should **not** be modeled as a Modbus TCP device

So the current project is correct on the transport boundary.

## HTTP Payload Review

### What is correct

The following parts are aligned in principle with official Shelly 3EM Gen1 behavior:

- `/status` contains `relays`, `emeters`, `total_power`, and `fs_mounted`
- `/emeter/{index}` uses the expected fields:
  - `power`
  - `pf`
  - `current`
  - `voltage`
  - `is_valid`
  - `total`
  - `total_returned`
- `/relay/0` exposes the expected relay state fields such as:
  - `ison`
  - `has_timer`
  - `timer_started`
  - `timer_duration`
  - `timer_remaining`
  - `overpower`
  - `source`

The internal use of `input` and `holding` registers for Shelly is acceptable as an implementation detail.
Those registers are acting as simulator state storage behind the HTTP endpoints, not as a real Shelly Modbus register map.

### What is not correct

There are several places where the HTTP simulation does not match the official Shelly 3EM API shape.

#### 1. `/settings/emeter/{index}` is modeled incorrectly

Current simulator response:

- `name`
- `phase`
- `ct_type`
- `reverse`

Official Shelly 3EM response should expose:

- `appliance_type`
- `max_power`

This is the biggest protocol mismatch in the current Shelly profile because it changes the contract of a documented endpoint.

Current implementation:

- `src/http/shelly-server.ts`

#### 2. `/relay/0` is missing `is_valid`

Official Shelly 3EM relay payload includes `is_valid`.

The simulator's `getRelayPayload()` currently returns:

- `ison`
- `has_timer`
- `timer_started`
- `timer_duration`
- `timer_remaining`
- `overpower`
- `source`

It does not include:

- `is_valid`

Because `/status` reuses the same relay payload, that omission also affects `status.relays[0]`.

Current implementation:

- `src/http/shelly-server.ts`

#### 3. `/reset_data` returns the wrong body

Official Shelly 3EM:

- `GET /reset_data`
- response body: `{ "reset_data": 1 }`

Current simulator returns:

- `{ "isok": true, "restart_required": false }`

The state-reset side effect is reasonable, but the response shape is not compatible with the official API.

Current implementation:

- `src/http/shelly-server.ts`

#### 4. `/relay/0?turn=toggle` is extra behavior

The official Shelly 3EM documentation lists `turn=on` and `turn=off` for the HTTP relay endpoint.

The simulator also accepts:

- `turn=toggle`

This is not necessarily harmful for internal use, but it is not part of the documented Shelly 3EM HTTP contract reviewed here.

## Test Coverage Assessment

The repository already has Shelly-related tests, but they mostly verify:

- profile resolution
- transport selection
- endpoint availability
- basic state mutation

Relevant tests:

- `test/config-load.test.ts`
- `test/simulator-app.test.ts`

What is missing:

- conformance checks for exact `Shelly 3EM` payload shapes
- assertions for `/settings/emeter/{index}`
- assertions that `/relay/0` includes `is_valid`
- assertions that `/reset_data` returns the documented response body

## Overall Assessment

### Transport handling

Correct.

The project is right to keep Shelly 3EM out of the Modbus TCP listener path and serve it through the Shelly Gen1 HTTP path.

### Protocol fidelity

Partially correct.

The simulated Shelly 3EM HTTP API is directionally correct, but it is not yet fully protocol-compatible with the official Shelly 3EM Gen1 API.

The main issues are:

- wrong `/settings/emeter/{index}` contract
- missing `is_valid` on relay payloads
- wrong `/reset_data` response body

## Recommended Follow-up

If the goal is strict Shelly 3EM compatibility, the next implementation pass should:

1. change `/settings/emeter/{index}` to return `appliance_type` and `max_power`
2. add `is_valid: true` to `/relay/0` and to the relay object inside `/status`
3. change `/reset_data` to return `{ "reset_data": 1 }`
4. add regression tests for those exact payload shapes

If the goal is only "roughly usable local simulation", the current transport choice is still valid, but the documentation should clearly say that the HTTP payloads are simplified and not fully strict.

## Reference URLs

- Shelly Gen1 API reference:
  - https://shelly-api-docs.shelly.cloud/gen1/
- Shelly official Modbus support article:
  - https://support.shelly.cloud/en/support/solutions/articles/103000316046-which-devices-supports-modbus-
- Shelly Gen2/Gen3 Modbus component reference:
  - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Modbus/
