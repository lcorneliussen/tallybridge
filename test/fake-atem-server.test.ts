import assert from 'node:assert/strict'
import test from 'node:test'

import { Atem } from 'atem-connection'

import { buildStateChangeCommands } from '../src/atem-shim/commands.js'
import { FakeAtemServer } from '../src/atem-shim/FakeAtemServer.js'
import { SimulatedSwitcherSource } from '../src/switcher/SimulatedSwitcherSource.js'
import type { SwitcherSnapshot } from '../src/switcher/types.js'

test('fake atem server exposes simulator state to an atem client', async () => {
  const simulator = new SimulatedSwitcherSource({
    modelName: 'Test ATEM',
    autoStart: false,
    intervalMs: 1000,
    startProgramInput: 1,
    startPreviewInput: 2,
    sequence: [1, 2, 3, 4],
    inputs: [1, 2, 3, 4].map((id) => ({
      id,
      name: `C${id}`,
      longName: `Camera ${id}`,
      tallyChannel: id
    }))
  })

  const shim = new FakeAtemServer(simulator, {
    host: '127.0.0.1',
    port: 19910,
    identity: {
      productIdentifier: 'ATEM Constellation 8K',
      model: 'Constellation8K',
      protocolVersion: 'V9_6',
      videoMode: 'P1080p50'
    }
  })

  const client = new Atem()

  await simulator.start()
  await shim.start()

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for fake ATEM connection'))
      }, 1500)

      client.once('connected', () => {
        clearTimeout(timeout)
        resolve()
      })

      client.connect('127.0.0.1', 19910).catch(reject)
    })

    assert.equal(client.state?.info.productIdentifier, 'ATEM Constellation 8K')
    assert.equal(client.state?.video.mixEffects[0]?.programInput, 1)
    assert.equal(client.state?.video.mixEffects[0]?.previewInput, 2)

    const stateChanged = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for tally change'))
      }, 1500)

      client.once('stateChanged', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    simulator.cut()
    await stateChanged

    assert.equal(client.state?.video.mixEffects[0]?.programInput, 2)
    assert.equal(client.state?.video.mixEffects[0]?.previewInput, 3)
  } finally {
    await client.destroy()
    await shim.stop()
    await simulator.stop()
  }
})

test('fake atem tally-by-source uses effective program and preview tally inputs', () => {
  const snapshot: SwitcherSnapshot = {
    connected: true,
    source: 'atem',
    modelName: 'Test ATEM',
    inputs: [1, 2, 3, 4].map((id) => ({
      id,
      name: `C${id}`,
      longName: `Camera ${id}`,
      tallyChannel: id
    })),
    programInput: 1,
    previewInput: 2,
    programTallyInputs: [1, 3],
    previewTallyInputs: [2, 4],
    autoSwitching: false,
    cycleCount: 0,
    updatedAt: new Date().toISOString()
  }

  const commands = buildStateChangeCommands(snapshot)
  const tallyCommand = commands.find((command) => command.toString('ascii', 4, 8) === 'TlSr')

  assert.ok(tallyCommand)
  assert.deepEqual(decodeTallyBySource(tallyCommand), {
    1: { program: true, preview: false },
    2: { program: false, preview: true },
    3: { program: true, preview: false },
    4: { program: false, preview: true }
  })
})

function decodeTallyBySource(command: Buffer): Record<number, { program: boolean; preview: boolean }> {
  const sourceCount = command.readUInt16BE(8)
  const result: Record<number, { program: boolean; preview: boolean }> = {}

  for (let index = 0; index < sourceCount; index += 1) {
    const offset = 10 + index * 3
    const source = command.readUInt16BE(offset)
    const flags = command.readUInt8(offset + 2)
    result[source] = {
      program: (flags & 0x01) > 0,
      preview: (flags & 0x02) > 0
    }
  }

  return result
}
