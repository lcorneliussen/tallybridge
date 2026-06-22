import assert from 'node:assert/strict'
import net, { type AddressInfo } from 'node:net'
import test from 'node:test'
import { once } from 'node:events'

import { TcpProbeServer } from '../src/tcp-probe/TcpProbeServer.js'
import { SwitcherSource } from '../src/switcher/contracts.js'
import { SimulatedSwitcherSource } from '../src/switcher/SimulatedSwitcherSource.js'
import type { SwitcherSnapshot } from '../src/switcher/types.js'

function buildSimulator() {
  return new SimulatedSwitcherSource({
    modelName: 'Test ATEM',
    autoStart: false,
    intervalMs: 1000,
    startProgramInput: 1,
    startPreviewInput: 2,
    sequence: [1, 2, 3, 4],
    inputs: [1, 2, 3, 4].map((id) => ({
      id,
      name: `Cam ${id}`,
      longName: `Camera ${id}`,
      tallyChannel: id
    }))
  })
}

function buildSnapshot(overrides: Partial<SwitcherSnapshot> = {}): SwitcherSnapshot {
  return {
    connected: true,
    source: 'atem',
    modelName: 'Test ATEM',
    inputs: [1, 2, 3, 4].map((id) => ({
      id,
      name: `Cam ${id}`,
      longName: `Camera ${id}`,
      tallyChannel: id
    })),
    programInput: 1,
    previewInput: 2,
    programTallyInputs: [1],
    previewTallyInputs: [2],
    autoSwitching: false,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

class StaticSwitcherSource extends SwitcherSource {
  constructor(private snapshot: SwitcherSnapshot) {
    super()
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  getSnapshot(): SwitcherSnapshot {
    return structuredClone(this.snapshot)
  }
}

async function connect(port: number): Promise<net.Socket> {
  const socket = net.createConnection({ host: '127.0.0.1', port })
  await once(socket, 'connect')
  return socket
}

async function getFreePort(): Promise<number> {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const { port } = address as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function readUntil(
  socket: net.Socket,
  expected: string,
  timeoutMs = 2000
): Promise<string> {
  let buffer = ''

  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${JSON.stringify(expected)}. Received ${JSON.stringify(buffer)}`))
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.includes(expected)) {
        cleanup()
        resolve(buffer)
      }
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      clearTimeout(timeout)
      socket.off('data', onData)
      socket.off('error', onError)
    }

    socket.on('data', onData)
    socket.on('error', onError)
  })
}

test('vmix probe mode answers TALLY with vmix-style digits', async () => {
  const source = buildSimulator()
  await source.start()
  const tallyPort = await getFreePort()
  const heartbeatPort = await getFreePort()

  const probes = new TcpProbeServer(
    {
      host: '127.0.0.1',
      ports: [tallyPort, heartbeatPort],
      responseVariant: 'vmix'
    },
    source
  )

  await probes.start()

  try {
    const tallySocket = await connect(tallyPort)
    const heartbeatSocket = await connect(heartbeatPort)

    try {
      const tallyRead = readUntil(tallySocket, 'TALLY OK 1200\r\n')
      const heartbeatRead = readUntil(heartbeatSocket, '\r\nPONG:\r\n')

      tallySocket.write('TALLY\r\n')
      heartbeatSocket.write('\r\nPING:\r\n')

      const tallyResponse = await tallyRead
      const heartbeatResponse = await heartbeatRead

      assert.match(tallyResponse, /TALLY OK 1200\r\n/)
      assert.match(heartbeatResponse, /\r\nPONG:\r\n/)
    } finally {
      tallySocket.end()
      heartbeatSocket.end()
    }
  } finally {
    await probes.stop()
    await source.stop()
  }
})

test('vmix probe mode pushes tally updates immediately on state changes', async () => {
  const source = buildSimulator()
  await source.start()
  const tallyPort = await getFreePort()
  const heartbeatPort = await getFreePort()

  const probes = new TcpProbeServer(
    {
      host: '127.0.0.1',
      ports: [tallyPort, heartbeatPort],
      responseVariant: 'vmix'
    },
    source
  )

  await probes.start()

  try {
    const tallySocket = await connect(tallyPort)

    try {
      const initialRead = readUntil(tallySocket, 'TALLY OK 1200\r\n')
      tallySocket.write('TALLY\r\n')
      const initialTally = await initialRead

      assert.match(initialTally, /TALLY OK 1200\r\n/)

      const pushedRead = readUntil(tallySocket, 'TALLY OK 0120\r\n')
      source.cut()
      const pushedTally = await pushedRead

      assert.match(pushedTally, /TALLY OK 0120\r\n/)
    } finally {
      tallySocket.end()
    }
  } finally {
    await probes.stop()
    await source.stop()
  }
})

test('vmix probe mode marks ATEM keyer-visible inputs as program', async () => {
  const source = new StaticSwitcherSource(
    buildSnapshot({
      programInput: 1,
      previewInput: 2,
      programTallyInputs: [1, 3],
      previewTallyInputs: [2]
    })
  )
  await source.start()
  const tallyPort = await getFreePort()
  const heartbeatPort = await getFreePort()

  const probes = new TcpProbeServer(
    {
      host: '127.0.0.1',
      ports: [tallyPort, heartbeatPort],
      responseVariant: 'vmix'
    },
    source
  )

  await probes.start()

  try {
    const tallySocket = await connect(tallyPort)

    try {
      const tallyRead = readUntil(tallySocket, 'TALLY OK 1210\r\n')
      tallySocket.write('TALLY\r\n')
      const tallyResponse = await tallyRead

      assert.match(tallyResponse, /TALLY OK 1210\r\n/)
    } finally {
      tallySocket.end()
    }
  } finally {
    await probes.stop()
    await source.stop()
  }
})

test('vmix probe mode answers ACTS Overlay1 with the active program input', async () => {
  const source = buildSimulator()
  await source.start()
  const tallyPort = await getFreePort()
  const heartbeatPort = await getFreePort()

  const probes = new TcpProbeServer(
    {
      host: '127.0.0.1',
      ports: [tallyPort, heartbeatPort],
      responseVariant: 'vmix'
    },
    source
  )

  await probes.start()

  try {
    const tallySocket = await connect(tallyPort)

    try {
      const actsRead = readUntil(tallySocket, 'ACTS OK Overlay1 1 1\r\n')
      tallySocket.write('ACTS Overlay1\r\n')
      const actsResponse = await actsRead

      assert.match(actsResponse, /ACTS OK Overlay1 1 1\r\n/)
    } finally {
      tallySocket.end()
    }
  } finally {
    await probes.stop()
    await source.stop()
  }
})

test('vmix probe mode answers unused overlays with No Input', async () => {
  const source = buildSimulator()
  await source.start()
  const tallyPort = await getFreePort()
  const heartbeatPort = await getFreePort()

  const probes = new TcpProbeServer(
    {
      host: '127.0.0.1',
      ports: [tallyPort, heartbeatPort],
      responseVariant: 'vmix'
    },
    source
  )

  await probes.start()

  try {
    const tallySocket = await connect(tallyPort)

    try {
      const actsRead = readUntil(tallySocket, 'ACTS ER No Input\r\n')
      tallySocket.write('ACTS Overlay2\r\n')
      const actsResponse = await actsRead

      assert.match(actsResponse, /ACTS ER No Input\r\n/)
    } finally {
      tallySocket.end()
    }
  } finally {
    await probes.stop()
    await source.stop()
  }
})
