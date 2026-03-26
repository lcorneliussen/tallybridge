import dgram from 'node:dgram'

import {
  buildInitialStateCommands,
  buildStateChangeCommands,
  type AtemIdentityConfig
} from './commands.js'
import { SwitcherSource } from '../switcher/contracts.js'

const MAX_PACKET_ID = 1 << 15
const ATEM_CONNECT_HELLO = Buffer.from([
  0x10, 0x14, 0x53, 0xab, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3a, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
])

const enum PacketFlag {
  AckRequest = 1,
  NewSessionId = 2,
  AckReply = 16
}

export interface FakeAtemServerOptions {
  host: string
  port: number
  identity: AtemIdentityConfig
}

interface ClientSession {
  key: string
  address: string
  port: number
  sessionId: number
  nextPacketId: number
  established: boolean
  handshakePacketId?: number
  initialStateSent: boolean
  packetsReceived: number
  packetsSent: number
  lastPacketType?: string
  lastPacketFlags?: number
  lastPacketLength?: number
  helloSeen: boolean
  lastSeenAt: string
  lastHelloAt?: string
  establishedAt?: string
}

export interface FakeAtemClientStatus {
  remote: string
  established: boolean
  helloSeen: boolean
  packetsReceived: number
  packetsSent: number
  lastPacketType?: string
  lastPacketFlags?: number
  lastPacketLength?: number
  lastSeenAt: string
  lastHelloAt?: string
  establishedAt?: string
}

export interface FakeAtemServerStatus {
  listening: boolean
  bind: string
  clientCount: number
  clients: FakeAtemClientStatus[]
}

export class FakeAtemServer {
  private readonly socket = dgram.createSocket('udp4')
  private readonly clients = new Map<string, ClientSession>()
  private listening = false

  constructor(
    private readonly source: SwitcherSource,
    private readonly options: FakeAtemServerOptions
  ) {}

  async start(): Promise<void> {
    this.source.on('stateChanged', (snapshot) => {
      const commands = buildStateChangeCommands(snapshot)
      for (const client of this.clients.values()) {
        if (client.established) {
          this.sendCommandPacket(client, commands)
        }
      }
    })

    this.socket.on('message', (packet, remote) => {
      this.handleMessage(packet, remote.address, remote.port)
    })

    await new Promise<void>((resolve, reject) => {
      this.socket.once('error', reject)
      this.socket.bind(this.options.port, this.options.host, () => {
        this.socket.off('error', reject)
        this.listening = true
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.listening) {
      return
    }

    await new Promise<void>((resolve) => {
      this.socket.close(() => {
        this.listening = false
        resolve()
      })
    })
  }

  getStatus(): FakeAtemServerStatus {
    return {
      listening: this.listening,
      bind: `${this.options.host}:${this.options.port}`,
      clientCount: this.clients.size,
      clients: Array.from(this.clients.values()).map((client) => ({
        remote: client.key,
        established: client.established,
        helloSeen: client.helloSeen,
        packetsReceived: client.packetsReceived,
        packetsSent: client.packetsSent,
        lastPacketType: client.lastPacketType,
        lastPacketFlags: client.lastPacketFlags,
        lastPacketLength: client.lastPacketLength,
        lastSeenAt: client.lastSeenAt,
        lastHelloAt: client.lastHelloAt,
        establishedAt: client.establishedAt
      }))
    }
  }

  private handleMessage(packet: Buffer, address: string, port: number): void {
    if (packet.length < 12) {
      return
    }

    const length = packet.readUInt16BE(0) & 0x07ff
    if (length !== packet.length) {
      return
    }

    const flags = packet.readUInt8(0) >> 3
    const remotePacketId = packet.readUInt16BE(10)
    const key = `${address}:${port}`
    let client = this.clients.get(key)

    if (!client) {
      client = {
        key,
        address,
        port,
        sessionId: randomSessionId(),
        nextPacketId: 1,
        established: false,
        initialStateSent: false,
        packetsReceived: 0,
        packetsSent: 0,
        helloSeen: false,
        lastSeenAt: new Date().toISOString(),
        lastPacketType: undefined,
        lastPacketFlags: undefined,
        lastPacketLength: undefined
      }
      this.clients.set(key, client)
      console.log(`[shim] first packet from ${client.key}`)
    }

    client.packetsReceived += 1
    client.lastSeenAt = new Date().toISOString()
    client.lastPacketFlags = flags
    client.lastPacketLength = packet.length

    if (!client.established && isHandshakeHello(packet)) {
      client.lastPacketType = 'hello'
      client.helloSeen = true
      client.lastHelloAt = client.lastSeenAt
      console.log(`[shim] hello from ${client.key}`)
      this.sendNewSessionPacket(client)
      return
    }

    if (
      !client.initialStateSent &&
      (flags & PacketFlag.AckReply) &&
      client.handshakePacketId !== undefined &&
      packet.readUInt16BE(4) === client.handshakePacketId
    ) {
      client.lastPacketType = 'ack-reply'
      client.established = true
      client.initialStateSent = true
      client.establishedAt = new Date().toISOString()
      console.log(`[shim] session established for ${client.key}`)
      this.sendCommandPacket(
        client,
        buildInitialStateCommands(this.source.getSnapshot(), this.options.identity)
      )
      return
    }

    if (flags & PacketFlag.AckRequest) {
      client.lastPacketType = 'ack-request'
      console.log(`[shim] data packet from ${client.key} flags=${flags} length=${packet.length}`)
      this.sendAck(client, remotePacketId)
      return
    }

    client.lastPacketType = 'other'
    console.log(`[shim] unhandled packet from ${client.key} flags=${flags} length=${packet.length}`)
  }

  private sendNewSessionPacket(client: ClientSession): void {
    const packet = Buffer.alloc(12)
    packet.writeUInt16BE((PacketFlag.NewSessionId << 11) | 12, 0)
    packet.writeUInt16BE(client.sessionId, 2)
    packet.writeUInt16BE(client.nextPacketId, 10)
    client.handshakePacketId = client.nextPacketId
    client.nextPacketId = nextPacketId(client.nextPacketId)
    this.sendPacket(client, packet)
  }

  private sendCommandPacket(client: ClientSession, commands: Buffer[]): void {
    const payload = Buffer.concat(commands)
    const packet = Buffer.alloc(12 + payload.length)
    packet.writeUInt16BE((PacketFlag.AckRequest << 11) | packet.length, 0)
    packet.writeUInt16BE(client.sessionId, 2)
    packet.writeUInt16BE(client.nextPacketId, 10)
    payload.copy(packet, 12)
    client.nextPacketId = nextPacketId(client.nextPacketId)
    this.sendPacket(client, packet)
  }

  private sendAck(client: ClientSession, packetId: number): void {
    const packet = Buffer.alloc(12)
    packet.writeUInt16BE((PacketFlag.AckReply << 11) | 12, 0)
    packet.writeUInt16BE(client.sessionId, 2)
    packet.writeUInt16BE(packetId, 4)
    this.sendPacket(client, packet)
  }

  private sendPacket(client: ClientSession, packet: Buffer): void {
    client.packetsSent += 1
    this.socket.send(packet, client.port, client.address)
  }
}

function randomSessionId(): number {
  return Math.floor(Math.random() * 0xffff)
}

function nextPacketId(current: number): number {
  return (current + 1) % MAX_PACKET_ID
}

function isHandshakeHello(packet: Buffer): boolean {
  return packet.length === ATEM_CONNECT_HELLO.length && packet.equals(ATEM_CONNECT_HELLO)
}
