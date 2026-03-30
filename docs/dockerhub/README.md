# Energy Device Simulator

An open-source simulator from [EnergyMeterHub](https://www.energymeterhub.com) for local energy-device integration testing in Docker.

The current image includes IAMMETER, Fronius SunSpec, and Shelly profiles, and the project is designed to grow into a larger library of meter, inverter, gateway, and energy-device protocol simulators.

## Quick Start

Default IAMMETER profile:

```bash
docker run --rm -p 1502:1502 -p 5092:5092 energymeterhub/energy-device-simulator:latest
```

Open `http://127.0.0.1:5092/` for the control UI.

## Other Profiles

Today the image ships with a few built-in profiles, but it is not limited to only these three devices.

Fronius SunSpec:

```bash
docker run --rm -p 1503:1503 -p 5092:5092 energymeterhub/energy-device-simulator:latest start examples/devices/fronius-sunspec.json --system examples/system/docker.json
```

Shelly Pro 3EM:

```bash
docker run --rm -p 18080:18080 -p 5092:5092 energymeterhub/energy-device-simulator:latest start shelly-3em --system examples/system/docker.json
```

## Included Ports

- `5092` control API and local UI
- `1502` IAMMETER dev Modbus TCP
- `1503` Fronius SunSpec example Modbus TCP
- `18080` Shelly Pro 3EM RPC HTTP

## Image Tags

- `latest`
- version tags such as `0.4.0`

## Source

- EnergyMeterHub: https://www.energymeterhub.com
- GitHub: https://github.com/energymeterhub/energy-device-simulator
- npm: https://www.npmjs.com/package/energy-device-simulator
