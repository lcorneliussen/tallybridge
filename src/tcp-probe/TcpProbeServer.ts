import net, { type Socket } from 'node:net'

import { wrapListenerError } from '../startup/diagnostics.js'
import type { SwitcherSource } from '../switcher/contracts.js'
import type { SwitcherSnapshot } from '../switcher/types.js'

export interface TcpProbeServerOptions {
  host: string
  ports: number[]
  responseVariant?: ProbeResponseVariant
}

export type ProbeResponseVariant =
  | 'current'
  | 'silent'
  | 'echo'
  | 'compact'
  | 'kv'
  | 'vmix'

interface ProbeClient {
  id: string
  remote: string
  localPort: number
  protocol?: 'tally' | 'heartbeat'
  connectedAt: string
  lastSeenAt: string
  endedAt?: string
  bytesReceived: number
  bytesSent: number
  chunksReceived: number
  chunksSent: number
  open: boolean
  firstPayloadHex?: string
  firstPayloadAscii?: string
  firstResponseHex?: string
  firstResponseAscii?: string
  recentPayloads: string[]
  recentResponses: string[]
  subscriptions: Set<string>
  socket?: Socket
}

export interface TcpProbeClientStatus {
  id: string
  remote: string
  localPort: number
  protocol?: 'tally' | 'heartbeat'
  connectedAt: string
  lastSeenAt: string
  endedAt?: string
  bytesReceived: number
  bytesSent: number
  chunksReceived: number
  chunksSent: number
  open: boolean
  firstPayloadHex?: string
  firstPayloadAscii?: string
  firstResponseHex?: string
  firstResponseAscii?: string
  recentPayloads: string[]
  recentResponses: string[]
}

export interface TcpProbeFrame {
  timestamp: string
  remote: string
  port: number
  direction: 'in' | 'out'
  length: number
  hex: string
  ascii: string
}

export interface TcpProbePortStatus {
  port: number
  listening: boolean
  clientCount: number
  clients: TcpProbeClientStatus[]
}

export interface TcpProbeServerStatus {
  host: string
  responseVariant: ProbeResponseVariant
  supportedVariants: ProbeResponseVariant[]
  recentFrames: TcpProbeFrame[]
  ports: TcpProbePortStatus[]
}

export class TcpProbeServer {
  private readonly servers = new Map<number, net.Server>()
  private readonly clientsByPort = new Map<number, Map<string, ProbeClient>>()
  private readonly recentFrames: TcpProbeFrame[] = []
  private responseVariant: ProbeResponseVariant

  constructor(
    private readonly options: TcpProbeServerOptions,
    private readonly source: SwitcherSource
  ) {
    this.responseVariant = options.responseVariant ?? 'current'
  }

  async start(): Promise<void> {
    this.source.on('stateChanged', (snapshot) => {
      this.broadcastTally(snapshot)
    })
    await Promise.all(this.options.ports.map((port) => this.startPort(port)))
  }

  async stop(): Promise<void> {
    for (const clients of this.clientsByPort.values()) {
      for (const client of clients.values()) {
        client.open = false
        client.endedAt ??= new Date().toISOString()
        client.socket?.destroy()
        client.socket = undefined
      }
    }

    await Promise.all(
      Array.from(this.servers.entries()).map(async ([port, server]) => {
        await new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
        this.servers.delete(port)
      })
    )
  }

  getStatus(): TcpProbeServerStatus {
    return {
      host: this.options.host,
      responseVariant: this.responseVariant,
      supportedVariants: ['current', 'silent', 'echo', 'compact', 'kv', 'vmix'],
      recentFrames: [...this.recentFrames],
      ports: this.options.ports.map((port) => ({
        port,
        listening: this.servers.has(port),
        clientCount: this.clientsByPort.get(port)?.size ?? 0,
        clients: Array.from(this.clientsByPort.get(port)?.values() ?? []).map((client) =>
          sanitizeClient(client)
        )
      }))
    }
  }

  getResponseVariant(): ProbeResponseVariant {
    return this.responseVariant
  }

  setResponseVariant(variant: ProbeResponseVariant): ProbeResponseVariant {
    this.responseVariant = variant
    console.log(`[probe] response variant set to ${variant}`)
    return this.responseVariant
  }

  private async startPort(port: number): Promise<void> {
    const clients = new Map<string, ProbeClient>()
    this.clientsByPort.set(port, clients)

    const server = net.createServer((socket) => {
      this.handleSocket(socket, port, clients)
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        reject(
          wrapListenerError(error, {
            component: 'TCP probe server',
            protocol: 'tcp',
            host: this.options.host,
            port
          })
        )
      }

      server.once('error', onError)
      server.listen(port, this.options.host, () => {
        server.off('error', onError)
        console.log(`[probe] listening on tcp://${this.options.host}:${port}`)
        resolve()
      })
    })

    this.servers.set(port, server)
  }

  private handleSocket(socket: Socket, port: number, clients: Map<string, ProbeClient>): void {
    const remote = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`
    const id = `${remote}->${port}`
    const now = new Date().toISOString()

    const client: ProbeClient = {
      id,
      remote,
      localPort: port,
      connectedAt: now,
      lastSeenAt: now,
      bytesReceived: 0,
      bytesSent: 0,
      chunksReceived: 0,
      chunksSent: 0,
      open: true,
      recentPayloads: [],
      recentResponses: [],
      subscriptions: new Set<string>(),
      socket
    }

    clients.set(id, client)
    socket.setKeepAlive(true)
    socket.setNoDelay(true)
    console.log(`[probe] connection from ${remote} to tcp/${port}`)

    socket.on('data', (chunk) => {
      client.bytesReceived += chunk.length
      client.chunksReceived += 1
      client.lastSeenAt = new Date().toISOString()

      if (!client.firstPayloadHex) {
        client.firstPayloadHex = chunk.subarray(0, 128).toString('hex')
        client.firstPayloadAscii = sanitizeAscii(chunk.subarray(0, 128).toString('utf8'))
        console.log(
          `[probe] data from ${remote} on tcp/${port} len=${chunk.length} hex=${client.firstPayloadHex}`
        )
      } else {
        console.log(`[probe] data from ${remote} on tcp/${port} len=${chunk.length}`)
      }

      const ascii = sanitizeAscii(chunk.toString('utf8'))
      remember(client.recentPayloads, ascii)
      this.recordFrame(client, 'in', chunk)
      this.respond(client, chunk)
    })

    socket.on('end', () => {
      client.open = false
      client.endedAt = new Date().toISOString()
      client.socket = undefined
      console.log(`[probe] end from ${remote} on tcp/${port}`)
    })

    socket.on('close', () => {
      client.open = false
      client.endedAt ??= new Date().toISOString()
      client.socket = undefined
      console.log(`[probe] close from ${remote} on tcp/${port}`)
    })

    socket.on('error', (error) => {
      client.open = false
      client.endedAt ??= new Date().toISOString()
      client.socket = undefined
      console.log(`[probe] error from ${remote} on tcp/${port}: ${error.message}`)
    })
  }

  private respond(client: ProbeClient, chunk: Buffer): void {
    const text = chunk.toString('utf8')
    const snapshot = this.source.getSnapshot()

    switch (this.responseVariant) {
      case 'silent':
        return
      case 'echo':
        if (text.includes('PING:')) {
          client.protocol = 'heartbeat'
          this.send(client, chunk.toString('utf8'))
          return
        }
        if (looksLikeVmixCommand(text)) {
          client.protocol = 'tally'
          this.send(client, 'TALLY\r\n')
        }
        return
      case 'compact':
        if (text.includes('PING:')) {
          client.protocol = 'heartbeat'
          this.send(client, '\r\nPONG:\r\n')
          return
        }
        if (looksLikeVmixCommand(text)) {
          client.protocol = 'tally'
          this.send(
            client,
            `TALLY:${snapshot.programInput}:${snapshot.previewInput}\r\n`
          )
        }
        return
      case 'kv':
        if (text.includes('PING:')) {
          client.protocol = 'heartbeat'
          this.send(client, '\r\nPONG:\r\n')
          return
        }
        if (looksLikeVmixCommand(text)) {
          client.protocol = 'tally'
          this.send(
            client,
            `TALLY\r\nPGM:${snapshot.programInput}\r\nPVW:${snapshot.previewInput}\r\n\r\n`
          )
        }
        return
      case 'vmix':
        if (text.includes('PING:')) {
          client.protocol = 'heartbeat'
          this.send(client, '\r\nPONG:\r\n')
          return
        }
        if (looksLikeVmixCommand(text)) {
          client.protocol = 'tally'
          this.respondAsVmix(client, text, snapshot)
        }
        return
      case 'current':
      default:
        break
    }

    if (text.includes('PING:')) {
      client.protocol = 'heartbeat'
      this.send(client, '\r\nPONG:\r\n')
      return
    }

    if (looksLikeVmixCommand(text)) {
      client.protocol = 'tally'
      this.send(client, renderTallySnapshot(snapshot))
    }
  }

  private broadcastTally(snapshot: SwitcherSnapshot): void {
    for (const clients of this.clientsByPort.values()) {
      for (const client of clients.values()) {
        if (!client.open) {
          continue
        }

        if (client.protocol !== 'tally') {
          continue
        }

        if (this.responseVariant === 'vmix') {
          this.send(client, renderVmixTallyResponse(snapshot))
          continue
        }

        this.send(client, renderTallySnapshot(snapshot))
      }
    }
  }

  private respondAsVmix(
    client: ProbeClient,
    text: string,
    snapshot: SwitcherSnapshot
  ): void {
    const commands = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    for (const command of commands) {
      if (command === 'TALLY') {
        this.send(client, renderVmixTallyResponse(snapshot))
        continue
      }

      if (command.startsWith('ACTS ')) {
        this.send(client, renderVmixActsResponse(command, snapshot))
        continue
      }

      if (command === 'SUBSCRIBE TALLY') {
        client.subscriptions.add('TALLY')
        this.send(client, 'SUBSCRIBE OK TALLY\r\n')
        this.send(client, renderVmixTallyResponse(snapshot))
        continue
      }

      if (command === 'SUBSCRIBE ACTS') {
        client.subscriptions.add('ACTS')
        this.send(client, 'SUBSCRIBE OK ACTS\r\n')
        continue
      }

      if (command === 'UNSUBSCRIBE TALLY') {
        client.subscriptions.delete('TALLY')
        this.send(client, 'UNSUBSCRIBE OK TALLY\r\n')
        continue
      }

      if (command === 'UNSUBSCRIBE ACTS') {
        client.subscriptions.delete('ACTS')
        this.send(client, 'UNSUBSCRIBE OK ACTS\r\n')
        continue
      }

      if (command === 'QUIT') {
        this.send(client, 'QUIT OK\r\n')
        client.socket?.end()
        continue
      }

      const [keyword] = command.split(/\s+/, 1)
      this.send(client, `${keyword ?? 'UNKNOWN'} ER Unknown command\r\n`)
    }
  }

  private send(client: ProbeClient, payload: string): void {
    if (!client.socket || !client.open) {
      return
    }

    client.socket.write(payload)
    client.bytesSent += Buffer.byteLength(payload)
    client.chunksSent += 1
    if (!client.firstResponseHex) {
      client.firstResponseHex = Buffer.from(payload).subarray(0, 128).toString('hex')
      client.firstResponseAscii = sanitizeAscii(payload.slice(0, 128))
    }
    remember(client.recentResponses, sanitizeAscii(payload))
    this.recordFrame(client, 'out', Buffer.from(payload))
    console.log(`[probe] sent to ${client.remote} on tcp/${client.localPort}: ${sanitizeAscii(payload)}`)
  }

  private recordFrame(client: ProbeClient, direction: 'in' | 'out', payload: Buffer): void {
    this.recentFrames.push({
      timestamp: new Date().toISOString(),
      remote: client.remote,
      port: client.localPort,
      direction,
      length: payload.length,
      hex: payload.subarray(0, 128).toString('hex'),
      ascii: sanitizeAscii(payload.subarray(0, 128).toString('utf8'))
    })

    while (this.recentFrames.length > 40) {
      this.recentFrames.shift()
    }
  }
}

function sanitizeAscii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '.')
}

function remember(target: string[], value: string): void {
  target.push(value)
  while (target.length > 5) {
    target.shift()
  }
}

function looksLikeVmixCommand(value: string): boolean {
  return /\b(TALLY|ACTS|SUBSCRIBE|UNSUBSCRIBE|QUIT)\b/.test(value)
}

function renderTallySnapshot(snapshot: SwitcherSnapshot): string {
  const lines = [
    'TALLY',
    `PROGRAM:${snapshot.programInput}`,
    `PREVIEW:${snapshot.previewInput}`,
    ...snapshot.inputs.map((input) => {
      const state =
        input.id === snapshot.programInput
          ? 'PGM'
          : input.id === snapshot.previewInput
            ? 'PVW'
            : 'OFF'
      return `INPUT:${input.id}:${state}`
    }),
    ''
  ]

  return `${lines.join('\r\n')}\r\n`
}

function renderVmixTallyResponse(snapshot: SwitcherSnapshot): string {
  return `TALLY OK ${renderVmixTallyStates(snapshot)}\r\n`
}

function renderVmixTallyStates(snapshot: SwitcherSnapshot): string {
  return snapshot.inputs
    .filter((input) => input.id > 0)
    .map((input) => {
      if (input.id === snapshot.programInput) {
        return '1'
      }

      if (input.id === snapshot.previewInput) {
        return '2'
      }

      return '0'
    })
    .join('')
}

function renderVmixActsResponse(command: string, snapshot: SwitcherSnapshot): string {
  const [, activatorName = '', inputNumberText] = command.match(/^ACTS\s+(\S+)(?:\s+(\d+))?$/) ?? []
  if (!activatorName) {
    return 'ACTS ER Invalid activator\r\n'
  }

  if (activatorName === 'Overlay1') {
    return `ACTS OK Overlay1 ${snapshot.programInput} 1\r\n`
  }

  if (activatorName === 'Overlay2' || activatorName === 'Overlay3' || activatorName === 'Overlay4') {
    return 'ACTS ER No Input\r\n'
  }

  if (activatorName === 'Input') {
    const inputNumber = inputNumberText ? Number.parseInt(inputNumberText, 10) : snapshot.programInput
    const value = inputNumber === snapshot.programInput ? 1 : 0
    return `ACTS OK Input ${inputNumber} ${value}\r\n`
  }

  if (activatorName === 'InputPreview') {
    const inputNumber = inputNumberText ? Number.parseInt(inputNumberText, 10) : snapshot.previewInput
    const value = inputNumber === snapshot.previewInput ? 1 : 0
    return `ACTS OK InputPreview ${inputNumber} ${value}\r\n`
  }

  return `ACTS ER Unsupported activator ${activatorName}\r\n`
}

function sanitizeClient(client: ProbeClient): TcpProbeClientStatus {
  return {
    id: client.id,
    remote: client.remote,
    localPort: client.localPort,
    protocol: client.protocol,
    connectedAt: client.connectedAt,
    lastSeenAt: client.lastSeenAt,
    endedAt: client.endedAt,
    bytesReceived: client.bytesReceived,
    bytesSent: client.bytesSent,
    chunksReceived: client.chunksReceived,
    chunksSent: client.chunksSent,
    open: client.open,
    firstPayloadHex: client.firstPayloadHex,
    firstPayloadAscii: client.firstPayloadAscii,
    firstResponseHex: client.firstResponseHex,
    firstResponseAscii: client.firstResponseAscii,
    recentPayloads: [...client.recentPayloads],
    recentResponses: [...client.recentResponses]
  }
}
