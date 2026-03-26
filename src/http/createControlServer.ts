import http, { type IncomingMessage, type ServerResponse } from 'node:http'

import type { FakeAtemServer } from '../atem-shim/FakeAtemServer.js'
import type {
  ProbeResponseVariant,
  TcpProbeServer
} from '../tcp-probe/TcpProbeServer.js'
import {
  hasAutoSwitchingControlSurface,
  hasControlSurface,
  type SwitcherSource
} from '../switcher/contracts.js'

interface JsonResponse {
  statusCode?: number
  body: unknown
}

export function createControlServer(
  source: SwitcherSource,
  shim?: FakeAtemServer,
  probes?: TcpProbeServer
) {
  const eventClients = new Set<ServerResponse>()

  source.on('stateChanged', (snapshot, change) => {
    const message = JSON.stringify({ snapshot, change })
    for (const client of eventClients) {
      client.write(`event: stateChanged\n`)
      client.write(`data: ${message}\n\n`)
    }
  })

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://localhost')
    const pathname = url.pathname

    try {
      if (method === 'GET' && pathname === '/health') {
        return writeJson(response, { body: { ok: true } })
      }

      if (method === 'GET' && pathname === '/state') {
        return writeJson(response, { body: source.getSnapshot() })
      }

      if (method === 'GET' && pathname === '/shim/status') {
        return writeJson(response, {
          body: shim
            ? shim.getStatus()
            : {
                listening: false,
                bind: null,
                clientCount: 0,
                clients: []
              }
        })
      }

      if (method === 'GET' && pathname === '/probe/status') {
        return writeJson(response, {
          body: probes
            ? probes.getStatus()
            : {
                host: null,
                ports: []
              }
        })
      }

      if (method === 'POST' && pathname.startsWith('/probe/variant/')) {
        if (!probes) {
          throw new Error('TCP probes are not enabled.')
        }

        const variant = pathname.slice('/probe/variant/'.length)
        if (!isProbeResponseVariant(variant)) {
          throw new Error(`Unknown probe variant: ${variant}`)
        }

        return writeJson(response, {
          body: {
            responseVariant: probes.setResponseVariant(variant),
            status: probes.getStatus()
          }
        })
      }

      if (method === 'GET' && pathname === '/events') {
        return openEventStream(response, eventClients, source)
      }

      if (method === 'POST' && pathname.startsWith('/program/')) {
        ensureControlSurface(source)
        const inputId = extractInputId(pathname, '/program/')
        return writeJson(response, { body: await source.setProgramInput(inputId) })
      }

      if (method === 'POST' && pathname.startsWith('/preview/')) {
        ensureControlSurface(source)
        const inputId = extractInputId(pathname, '/preview/')
        return writeJson(response, { body: await source.setPreviewInput(inputId) })
      }

      if (method === 'POST' && pathname === '/cut') {
        ensureControlSurface(source)
        return writeJson(response, { body: await source.cut() })
      }

      if (method === 'POST' && pathname === '/auto/start') {
        ensureAutoSwitchingControlSurface(source)
        return writeJson(response, { body: await source.startAutoSwitching() })
      }

      if (method === 'POST' && pathname === '/auto/stop') {
        ensureAutoSwitchingControlSurface(source)
        return writeJson(response, { body: await source.stopAutoSwitching() })
      }

      return writeJson(response, {
        statusCode: 404,
        body: {
          error: 'Not found'
        }
      })
    } catch (error) {
      return writeJson(response, {
        statusCode: 400,
        body: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      })
    }
  })

  server.on('close', () => {
    for (const client of eventClients) {
      client.end()
    }
    eventClients.clear()
  })

  return server
}

function extractInputId(pathname: string, prefix: string): number {
  const rawValue = pathname.slice(prefix.length)
  const inputId = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(inputId)) {
    throw new Error(`Invalid input id: ${rawValue}`)
  }

  return inputId
}

function openEventStream(
  response: ServerResponse,
  eventClients: Set<ServerResponse>,
  source: SwitcherSource
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })

  eventClients.add(response)
  response.write(`event: connected\n`)
  response.write(`data: ${JSON.stringify(source.getSnapshot())}\n\n`)

  response.on('close', () => {
    eventClients.delete(response)
  })
}

function ensureControlSurface(source: SwitcherSource): asserts source is SwitcherSource & {
  setProgramInput(inputId: number): Promise<unknown> | unknown
  setPreviewInput(inputId: number): Promise<unknown> | unknown
  cut(): Promise<unknown> | unknown
} {
  if (!hasControlSurface(source)) {
    throw new Error('Current source does not expose program/preview/cut controls.')
  }
}

function ensureAutoSwitchingControlSurface(source: SwitcherSource): asserts source is SwitcherSource & {
  startAutoSwitching(): Promise<unknown> | unknown
  stopAutoSwitching(): Promise<unknown> | unknown
} {
  if (!hasAutoSwitchingControlSurface(source)) {
    throw new Error('Current source does not expose auto-switching controls.')
  }
}

function writeJson(response: ServerResponse, { statusCode = 200, body }: JsonResponse): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json'
  })
  response.end(JSON.stringify(body, null, 2))
}

function isProbeResponseVariant(value: string): value is ProbeResponseVariant {
  return ['current', 'silent', 'echo', 'compact', 'kv', 'vmix'].includes(value)
}
