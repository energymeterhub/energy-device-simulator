# Shelly Pro 3EM Protocol Review

## Scope

This note records the Shelly implementation now used by `energy-device-simulator`.

The simulator no longer models Shelly through the old Gen1 `/status` and `/emeter/{index}` API shape. It now targets the RPC interface used by Shelly Pro 3EM in default triphase mode.

## Transport Decision

Shelly Pro 3EM is treated as an HTTP RPC device, not a Modbus TCP device.

The simulator exposes:

- `GET /rpc/EM.GetStatus?id=0`
- `GET /rpc/EMData.GetStatus?id=0`

This matches the intended integration boundary for:

- real-time three-phase values from `EM.GetStatus`
- cumulative forward and reverse energy from `EMData.GetStatus`

## Payload Mapping

`EM.GetStatus?id=0` exposes:

- `a_voltage`, `b_voltage`, `c_voltage`
- `a_current`, `b_current`, `c_current`
- `n_current`
- `total_current`
- `a_act_power`, `b_act_power`
- `c_active_power`
- `total_act_power`

`EMData.GetStatus?id=0` exposes:

- `a_total_act_energy`, `b_total_act_energy`, `c_total_act_energy`
- `total_act`
- `a_total_act_ret_energy`, `b_total_act_ret_energy`, `c_total_act_ret_energy`
- `total_act_ret`

The simulator keeps its internal register-backed state, but those registers are only an implementation detail behind the RPC payloads.

## Reference URLs

- Shelly EM component RPC documentation:
  - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM
- Shelly EMData component RPC documentation:
  - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EMData
