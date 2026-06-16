import { networkInterfaces } from 'node:os'

import { FakeAtemServer } from './atem-shim/FakeAtemServer.js'
import { loadConfigWithDetails } from './config.js'
import { createControlServer } from './http/createControlServer.js'
import { enrichStartupErrorMessage, wrapListenerError } from './startup/diagnostics.js'
import { AtemLiveSource } from './switcher/AtemLiveSource.js'
import { SimulatedSwitcherSource } from './switcher/SimulatedSwitcherSource.js'
import { SwitcherSource } from './switcher/contracts.js'
import { TcpProbeServer } from './tcp-probe/TcpProbeServer.js'

async function main(): Promise<void> {
  const details = await loadConfigWithDetails(process.env.CONFIG_PATH)
  const { config } = details

  if (details.loadedFrom) {
    console.log(`Loaded config from ${details.loadedFrom}`)
  } else if (details.usedDefaults) {
    console.log('No config file found. Using built-in defaults.')
  }

  for (const warning of details.warnings) {
    console.warn(`Config warning: ${warning}`)
  }

  const source = buildSource(config)
  const shim = config.shim.enabled ? new FakeAtemServer(source, config.shim) : undefined
  const probes = config.probes.enabled ? new TcpProbeServer(config.probes, source) : undefined
  const server = createControlServer(source, shim, probes)

  source.on('stateChanged', (snapshot, change) => {
    console.log(
      `[${snapshot.source}:${change.reason}] program=${snapshot.programInput} preview=${snapshot.previewInput} auto=${snapshot.autoSwitching} connected=${snapshot.connected}`
    )
  })

  try {
    await source.start()
    if (shim) {
      await shim.start()
    }
    if (probes) {
      await probes.start()
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        reject(
          wrapListenerError(error, {
            component: 'Control server',
            protocol: 'tcp',
            host: config.server.host,
            port: config.server.port
          })
        )
      }

      server.once('error', onError)
      server.listen(config.server.port, config.server.host, () => {
        server.off('error', onError)
        console.log(
          `Control server listening on http://${config.server.host}:${config.server.port}`
        )
        const lanIps = detectLanIpv4Addresses()
        if (lanIps.length > 0) {
          console.log(`Likely LAN IPs for Hollyland: ${lanIps.join(', ')}`)
        }
        console.log('Endpoints: GET /state, GET /shim/status, GET /probe/status, GET /events, POST /probe/variant/:name, POST /program/:id, POST /preview/:id, POST /cut, POST /auto/start, POST /auto/stop')
        console.log(`Source mode: ${config.source.type}`)
        if (shim) {
          console.log(`ATEM shim listening on udp://${config.shim.host}:${config.shim.port}`)
        }
        if (probes) {
          console.log(
            `TCP probes listening on ${config.probes.ports
              .map((port) => `tcp://${config.probes.host}:${port}`)
              .join(', ')}`
          )
        }
        resolve()
      })
    })
  } catch (error) {
    throw new Error(await enrichStartupErrorMessage(error, details.loadedFrom))
  }

  const shutdown = async () => {
    console.log('Shutting down...')
    server.close()
    if (probes) {
      await probes.stop()
    }
    if (shim) {
      await shim.stop()
    }
    await source.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

function buildSource(
  config: Awaited<ReturnType<typeof loadConfigWithDetails>>['config']
): SwitcherSource {
  if (config.source.type === 'atem') {
    return new AtemLiveSource(config.source.atem)
  }

  return new SimulatedSwitcherSource(config.source.simulator)
}

function detectLanIpv4Addresses(): string[] {
  const interfaces = networkInterfaces()
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)

  return Array.from(new Set(addresses))
}
