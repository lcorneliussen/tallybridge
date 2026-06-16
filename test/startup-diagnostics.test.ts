import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { loadConfigWithDetails } from '../src/config.js'
import { enrichStartupErrorMessage, ListenerBindError } from '../src/startup/diagnostics.js'

test('loadConfigWithDetails warns when source.atem is configured without source.type', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'tallybridge-config-'))
  const configPath = path.join(tempDir, 'config.json')

  await writeFile(
    configPath,
    JSON.stringify({
      source: {
        atem: {
          host: '192.168.140.11',
          port: 9910,
          mixEffect: 0
        }
      }
    })
  )

  try {
    const details = await loadConfigWithDetails(configPath)

    assert.equal(details.loadedFrom, configPath)
    assert.equal(details.config.source.type, 'simulator')
    assert.match(details.warnings.join('\n'), /source\.type is not set to "atem"/)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('enrichStartupErrorMessage formats listener bind failures clearly', async () => {
  const error = new ListenerBindError('TCP probe server failed to bind tcp://0.0.0.0:9990: address already in use', {
    component: 'TCP probe server',
    protocol: 'tcp',
    host: '0.0.0.0',
    port: 9990
  })

  const message = await enrichStartupErrorMessage(error, '/tmp/tallybridge-config.json')

  assert.match(message, /TCP probe server failed to bind tcp:\/\/0\.0\.0\.0:9990: address already in use/)
  assert.match(message, /Loaded config from \/tmp\/tallybridge-config\.json/)
  assert.match(message, /lsof -nP -iTCP:9990/)
})
