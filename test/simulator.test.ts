import assert from 'node:assert/strict'
import test from 'node:test'

import { SimulatedSwitcherSource } from '../src/switcher/SimulatedSwitcherSource.js'

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

test('cut promotes preview to program and advances preview', async () => {
  const simulator = buildSimulator()
  await simulator.start()

  const snapshot = simulator.cut()

  assert.equal(snapshot.programInput, 2)
  assert.equal(snapshot.previewInput, 3)
})

test('manual program change keeps preview distinct', async () => {
  const simulator = buildSimulator()
  await simulator.start()

  const snapshot = simulator.setProgramInput(2)

  assert.equal(snapshot.programInput, 2)
  assert.equal(snapshot.previewInput, 3)
})

test('advanceOnce increments cycle count', async () => {
  const simulator = buildSimulator()
  await simulator.start()

  const snapshot = simulator.advanceOnce()

  assert.equal(snapshot.programInput, 2)
  assert.equal(snapshot.previewInput, 3)
  assert.equal(snapshot.cycleCount, 1)
})
