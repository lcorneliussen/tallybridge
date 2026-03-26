# tallybridge

Prototype bridge for two roles:

- read Program/Preview state from a real ATEM switcher
- expose a separate Hollyland-facing ATEM-like UDP service from this machine's IP
- translate Program/Preview state into tally updates

The app now supports two upstream source modes:

- `simulator`: local ATEM-style switching for development
- `atem`: connect to a real ATEM over the network and mirror its Program/Preview state

It also starts a minimal fake ATEM shim on UDP `9910`. That shim is intentionally narrow:

- accepts a client session
- reports a configurable ATEM identity
- publishes input metadata
- publishes Program/Preview state
- publishes tally-by-source updates when cuts happen

It also starts passive TCP probe listeners on `8099` and `9990` so you can observe non-ATEM Hollyland connection attempts.

## What it does today

- simulates an ATEM-style Program/Preview workflow
- cycles through configured camera inputs automatically
- lets you force Program, Preview, and Cut actions over HTTP
- streams switcher state changes over Server-Sent Events

## Quick start

```bash
npm install
cp config.example.json config.json
npm run dev
```

The control server defaults to `http://0.0.0.0:4010`.
The fake ATEM shim defaults to `udp://0.0.0.0:9910`.
The TCP probes default to `tcp://0.0.0.0:8099` and `tcp://0.0.0.0:9990`.
The default probe response mode is `vmix`, because Hollyland is polling `TALLY` on the same port and command shape that vMix documents for its TCP API.

## Real ATEM mode

Update `config.json`:

```json
{
  "source": {
    "type": "atem",
    "atem": {
      "host": "192.168.10.240",
      "port": 9910,
      "mixEffect": 0,
      "modelNameOverride": "ATEM Constellation 8K"
    }
  }
}
```

Then run:

```bash
npm start
```

In this mode:

- your bridge connects to the real ATEM at its own IP
- the bridge sees cuts by watching `programInput` and `previewInput`
- Hollyland should eventually connect to the bridge IP, not the real ATEM IP

## Shim behavior

When running in simulator mode, a client pointed at the bridge IP on UDP `9910` should see:

- a newer ATEM identity, defaulting to `ATEM Constellation 8K`
- available inputs from config
- the current live camera as Program
- the current next camera as Preview
- tally changes when the simulator cuts

Probe status is available at:

```bash
curl http://localhost:4010/probe/status
```

You can switch probe response formats at runtime:

```bash
curl -X POST http://localhost:4010/probe/variant/vmix
curl -X POST http://localhost:4010/probe/variant/current
curl -X POST http://localhost:4010/probe/variant/compact
curl -X POST http://localhost:4010/probe/variant/kv
curl -X POST http://localhost:4010/probe/variant/echo
curl -X POST http://localhost:4010/probe/variant/silent
```

In `vmix` mode:

- `8099` answers `TALLY` with `TALLY OK <digits>\r\n`
- each digit is `0` for off, `1` for program, `2` for preview
- tally updates are also pushed immediately on state changes to reduce Hollyland latency
- `9990` still answers the Hollyland heartbeat with `PONG`

## Control endpoints

```bash
curl http://localhost:4010/state
curl -N http://localhost:4010/events
curl -X POST http://localhost:4010/program/3
curl -X POST http://localhost:4010/preview/4
curl -X POST http://localhost:4010/cut
curl -X POST http://localhost:4010/auto/start
curl -X POST http://localhost:4010/auto/stop
```

## Why this shape

The source is intentionally separated from transport details. The next stages can slot in beside it:

1. `AtemLiveSource`: subscribe to your real ATEM via `atem-connection`
2. `TallyMapper`: translate ATEM inputs into Hollyland tally channels
3. `AtemShimServer`: expand the minimal handshake and state set as Hollyland proves it needs more

That keeps the cut-detection logic stable while the Hollyland-facing protocol layer evolves.
