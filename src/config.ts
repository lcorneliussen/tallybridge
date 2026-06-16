import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { Enums } from 'atem-connection'

import type { AtemIdentityConfig } from './atem-shim/commands.js'
import type { AtemLiveSourceOptions } from './switcher/AtemLiveSource.js'
import type { SimulatedSwitcherOptions } from './switcher/SimulatedSwitcherSource.js'
import type { SwitcherInput } from './switcher/types.js'

export interface AppConfig {
  server: {
    host: string
    port: number
  }
  probes: {
    enabled: boolean
    host: string
    ports: number[]
    responseVariant: 'current' | 'silent' | 'echo' | 'compact' | 'kv' | 'vmix'
  }
  shim: {
    enabled: boolean
    host: string
    port: number
    identity: AtemIdentityConfig
  }
  source: {
    type: 'simulator' | 'atem'
    simulator: SimulatedSwitcherOptions
    atem: AtemLiveSourceOptions
  }
}

export interface ConfigLoadDetails {
  config: AppConfig
  loadedFrom?: string
  usedDefaults: boolean
  warnings: string[]
}

type LegacyAppConfig = {
  server?: Partial<AppConfig['server']>
  probes?: Partial<AppConfig['probes']>
  shim?: Partial<AppConfig['shim']>
  simulator?: Partial<SimulatedSwitcherOptions>
  source?: Partial<AppConfig['source']>
}

const defaultInputs: SwitcherInput[] = [1, 2, 3, 4].map((id) => ({
  id,
  name: `Cam ${id}`,
  longName: `Camera ${id}`,
  tallyChannel: id
}))

const defaultConfig: AppConfig = {
  server: {
    host: '0.0.0.0',
    port: 4010
  },
  probes: {
    enabled: true,
    host: '0.0.0.0',
    ports: [8099, 9990],
    responseVariant: 'vmix'
  },
  shim: {
    enabled: true,
    host: '0.0.0.0',
    port: 9910,
    identity: {
      productIdentifier: 'ATEM Constellation 8K',
      model: 'Constellation8K',
      protocolVersion: 'V9_6',
      videoMode: 'P1080p50'
    }
  },
  source: {
    type: 'simulator',
    simulator: {
      modelName: 'ATEM Production Studio 4K (simulated)',
      autoStart: true,
      intervalMs: 3000,
      startProgramInput: 1,
      startPreviewInput: 2,
      sequence: [1, 2, 3, 4],
      inputs: defaultInputs
    },
    atem: {
      host: '192.168.10.240',
      port: 9910,
      mixEffect: 0,
      fallbackInputs: defaultInputs
    }
  }
}

export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const details = await loadConfigWithDetails(configPath)
  return details.config
}

export async function loadConfigWithDetails(
  configPath?: string
): Promise<ConfigLoadDetails> {
  const resolvedPaths = buildConfigSearchPaths(configPath)

  for (const resolvedPath of resolvedPaths) {
    try {
      const rawConfig = await readFile(resolvedPath, 'utf8')
      const parsed = JSON.parse(rawConfig) as LegacyAppConfig
      return {
        config: mergeConfig(parsed),
        loadedFrom: resolvedPath,
        usedDefaults: false,
        warnings: deriveConfigWarnings(parsed)
      }
    } catch (error) {
      const isMissing =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'

      if (isMissing) {
        continue
      }

      throw error
    }
  }

  return {
    config: structuredClone(defaultConfig),
    usedDefaults: true,
    warnings: []
  }
}

function mergeConfig(parsed: LegacyAppConfig): AppConfig {
  const server: Partial<AppConfig['server']> = parsed.server ?? {}
  const probes: Partial<AppConfig['probes']> = parsed.probes ?? {}
  const shim: Partial<AppConfig['shim']> = parsed.shim ?? {}
  const identity: Partial<AtemIdentityConfig> = shim.identity ?? {}
  const source: Partial<AppConfig['source']> = parsed.source ?? {}
  const simulator: Partial<SimulatedSwitcherOptions> =
    source.simulator ?? parsed.simulator ?? {}
  const atem: Partial<AtemLiveSourceOptions> = source.atem ?? {}

  return {
    server: {
      host: server.host ?? defaultConfig.server.host,
      port: server.port ?? defaultConfig.server.port
    },
    probes: {
      enabled: probes.enabled ?? defaultConfig.probes.enabled,
      host: probes.host ?? defaultConfig.probes.host,
      ports:
        probes.ports?.filter((port): port is number => Number.isInteger(port)) ??
        defaultConfig.probes.ports,
      responseVariant:
        probes.responseVariant ?? defaultConfig.probes.responseVariant
    },
    shim: {
      enabled: shim.enabled ?? defaultConfig.shim.enabled,
      host: shim.host ?? defaultConfig.shim.host,
      port: shim.port ?? defaultConfig.shim.port,
      identity: {
        productIdentifier:
          identity.productIdentifier ?? defaultConfig.shim.identity.productIdentifier,
        model: isEnumKey(identity.model, Enums.Model)
          ? identity.model
          : defaultConfig.shim.identity.model,
        protocolVersion: isEnumKey(identity.protocolVersion, Enums.ProtocolVersion)
          ? identity.protocolVersion
          : defaultConfig.shim.identity.protocolVersion,
        videoMode: isEnumKey(identity.videoMode, Enums.VideoMode)
          ? identity.videoMode
          : defaultConfig.shim.identity.videoMode
      }
    },
    source: {
      type: source.type ?? defaultConfig.source.type,
      simulator: {
        modelName: simulator.modelName ?? defaultConfig.source.simulator.modelName,
        autoStart: simulator.autoStart ?? defaultConfig.source.simulator.autoStart,
        intervalMs: simulator.intervalMs ?? defaultConfig.source.simulator.intervalMs,
        startProgramInput:
          simulator.startProgramInput ?? defaultConfig.source.simulator.startProgramInput,
        startPreviewInput:
          simulator.startPreviewInput ?? defaultConfig.source.simulator.startPreviewInput,
        sequence: simulator.sequence ?? defaultConfig.source.simulator.sequence,
        inputs: simulator.inputs ?? defaultConfig.source.simulator.inputs
      },
      atem: {
        host: atem.host ?? defaultConfig.source.atem.host,
        port: atem.port ?? defaultConfig.source.atem.port,
        mixEffect: atem.mixEffect ?? defaultConfig.source.atem.mixEffect,
        modelNameOverride:
          atem.modelNameOverride ?? defaultConfig.source.atem.modelNameOverride,
        fallbackInputs:
          atem.fallbackInputs ?? defaultConfig.source.atem.fallbackInputs
      }
    }
  }
}

function isEnumKey<TEnum extends object>(
  value: string | undefined,
  enumObject: TEnum
): value is Extract<keyof TEnum, string> {
  return typeof value === 'string' && value in enumObject
}

function buildConfigSearchPaths(configPath?: string): string[] {
  const candidates = [
    configPath ? path.resolve(configPath) : undefined,
    process.env.CONFIG_PATH ? path.resolve(process.env.CONFIG_PATH) : undefined,
    path.resolve(process.cwd(), 'config.json'),
    path.resolve(homedir(), '.config', 'tallybridge', 'config.json'),
    '/etc/tallybridge/config.json'
  ]

  return candidates.filter((candidate, index): candidate is string => {
    return typeof candidate === 'string' && candidates.indexOf(candidate) === index
  })
}

function deriveConfigWarnings(parsed: LegacyAppConfig): string[] {
  const warnings: string[] = []

  if (parsed.source?.atem && parsed.source?.type !== 'atem') {
    warnings.push(
      'Config contains source.atem settings, but source.type is not set to "atem". The app will fall back to simulator mode unless you add "source": { "type": "atem", ... }.'
    )
  }

  if (parsed.probes?.enabled === false && parsed.shim?.enabled === false) {
    warnings.push(
      'Both probes and shim are disabled. Hollyland clients will not have any bridge-facing listener to connect to.'
    )
  }

  return warnings
}
