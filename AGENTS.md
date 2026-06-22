# AGENTS.md

Project-specific reference for future work on `tallybridge`.

## Protocol Assumptions

- Do not assume downstream tally clients speak native ATEM first.
- Preserve support for the currently observed TCP probe path alongside any ATEM-style emulation work.
- Treat protocol behavior as something to verify with packet captures or live logs rather than by product marketing language alone.

## Config Expectations

- `source.atem` without `source.type: "atem"` falls back to simulator mode.
- Any config examples, migrations, or install docs should keep `source.type` explicit.
- Keep warnings for ambiguous-but-accepted config shapes.

## Listener Ports

- Current bridge listeners are:
  - HTTP `4010`
  - TCP `8099`
  - TCP `9990`
  - optional UDP `9910`
- Before debugging client behavior, verify port ownership first.
- Expect conflicts with vendor daemons or other video-control software on general-purpose hosts.

## Deployment Guidance

- Prefer a dedicated bridge host over a workstation that also runs vendor control software.
- A separate bridge host is the cleanest path for production use because port ownership and background services are easier to control.

## Startup Diagnostics

- Startup should log:
  - loaded config path
  - whether defaults were used
  - config warnings
  - source mode
  - successful listener binds
  - clear bind failures with component, protocol, host, and port
- Preserve or improve this behavior in future refactors.

## Packaging

- Homebrew installs should use the tapped formula in `Formula/tallybridge.rb`.
- Do not document standalone formula installs from release-asset `.rb` URLs.
- Release automation is expected to publish assets and then sync `Formula/tallybridge.rb` on `main`.

## Test Priorities

- Preserve tests for:
  - vMix-style `TALLY` responses
  - pushed tally updates after cuts
  - config warning when `source.atem` is present without `source.type: "atem"`
  - startup error formatting for bind conflicts

## Good Next Improvements

- Make `9990` optional or degrade more gracefully when occupied.
- Add explicit compatibility experiments for running with only `8099`.
- Detect and name common conflicting processes when a listener port is occupied.
- Keep install docs focused on dedicated-host deployment.
