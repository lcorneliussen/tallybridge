# tallybridge

Prototype bridge for two roles:

- read Program/Preview state from a real ATEM switcher
- expose a separate Hollyland-facing ATEM-like UDP service from this machine's IP
- translate Program/Preview state into tally updates

This project is aimed at retrofitting older ATEM switchers for [Hollyland Wireless Tally System](https://www.hollyland.com/product/wireless-tally-system) Ethernet tally workflows. It has been tested at least against an [ATEM Production Studio 4K](https://forum.blackmagicdesign.com/viewtopic.php?f=13&t=6790) as the upstream real switcher, while presenting a newer [ATEM Constellation 8K](https://www.blackmagicdesign.com/products/atemconstellation8k/features) identity toward the Hollyland side.

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
The config loader checks `CONFIG_PATH`, then `./config.json`, then `~/.config/tallybridge/config.json`, then `/etc/tallybridge/config.json`.

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

Known tested retrofit path:

- upstream real switcher: [`ATEM Production Studio 4K`](https://forum.blackmagicdesign.com/viewtopic.php?f=13&t=6790)
- downstream presented identity: [`ATEM Constellation 8K`](https://www.blackmagicdesign.com/products/atemconstellation8k/features)

## Installation

### Raspberry Pi / Debian

Release builds publish a `.deb` asset and expect a working `node` runtime on the target machine.

Typical install flow:

```bash
sudo apt-get update
sudo apt-get install -y nodejs
sudo apt install ./tallybridge_<version>_all.deb
sudo cp /etc/tallybridge/config.example.json /etc/tallybridge/config.json
sudo systemctl enable --now tallybridge
```

The installed service reads config from `/etc/tallybridge/config.json`.

### macOS with Homebrew

Tap this repository and install the formula from its tracked `Formula/` directory:

```bash
brew tap lcorneliussen/tallybridge https://github.com/lcorneliussen/tallybridge
brew install lcorneliussen/tallybridge/tallybridge
cp "$(brew --prefix)/etc/tallybridge/config.example.json" "$(brew --prefix)/etc/tallybridge/config.json"
brew services start tallybridge
```

The Homebrew service reads config from `$(brew --prefix)/etc/tallybridge/config.json` unless `CONFIG_PATH` is set.

This uses the formula in [`Formula/tallybridge.rb`](https://github.com/lcorneliussen/tallybridge/blob/main/Formula/tallybridge.rb), which points to the tagged release bundle and includes the required SHA-256 checksum. Installing a standalone formula file from a release URL is no longer a reliable Homebrew path.

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
