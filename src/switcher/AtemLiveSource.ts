import { Atem, Enums, listVisibleInputs, type AtemState } from 'atem-connection'

import { SwitcherSource } from './contracts.js'
import type { SwitcherChange, SwitcherInput, SwitcherSnapshot } from './types.js'
import { normalizeTallyInputs } from './tally.js'

export interface AtemLiveSourceOptions {
  host: string
  port: number
  mixEffect: number
  modelNameOverride?: string
  fallbackInputs?: SwitcherInput[]
}

export class AtemLiveSource extends SwitcherSource {
  private readonly atem = new Atem()
  private snapshot: SwitcherSnapshot
  private stateChangeCount = 0

  constructor(private readonly options: AtemLiveSourceOptions) {
    super()

    const fallbackInputs = options.fallbackInputs ?? []
    this.snapshot = {
      connected: false,
      source: 'atem',
      modelName: options.modelNameOverride ?? 'ATEM (connecting)',
      inputs: fallbackInputs,
      programInput: fallbackInputs[0]?.id ?? 0,
      previewInput: fallbackInputs[1]?.id ?? fallbackInputs[0]?.id ?? 0,
      programTallyInputs: fallbackInputs[0]?.id ? [fallbackInputs[0].id] : [],
      previewTallyInputs: fallbackInputs[1]?.id
        ? [fallbackInputs[1].id]
        : fallbackInputs[0]?.id
          ? [fallbackInputs[0].id]
          : [],
      autoSwitching: false,
      cycleCount: 0,
      updatedAt: new Date().toISOString()
    }
  }

  async start(): Promise<void> {
    this.atem.on('connected', () => {
      this.snapshot.connected = true
      this.snapshot.updatedAt = new Date().toISOString()
    })

    this.atem.on('disconnected', () => {
      this.snapshot.connected = false
      this.snapshot.updatedAt = new Date().toISOString()
      this.emitState('initial')
    })

    this.atem.on('stateChanged', (state) => {
      this.updateFromAtemState(state)
    })

    await this.atem.connect(this.options.host, this.options.port)

    const hydratedState = await this.waitForHydratedState()
    if (hydratedState) {
      this.updateFromAtemState(hydratedState)
    } else {
      this.emitState('initial')
    }
  }

  async stop(): Promise<void> {
    await this.atem.disconnect()
    await this.atem.destroy()
    this.snapshot.connected = false
    this.snapshot.updatedAt = new Date().toISOString()
  }

  getSnapshot(): SwitcherSnapshot {
    return structuredClone(this.snapshot)
  }

  async setProgramInput(inputId: number): Promise<SwitcherSnapshot> {
    await this.atem.changeProgramInput(inputId, this.options.mixEffect)
    return this.getSnapshot()
  }

  async setPreviewInput(inputId: number): Promise<SwitcherSnapshot> {
    await this.atem.changePreviewInput(inputId, this.options.mixEffect)
    return this.getSnapshot()
  }

  async cut(): Promise<SwitcherSnapshot> {
    await this.atem.cut(this.options.mixEffect)
    return this.getSnapshot()
  }

  private updateFromAtemState(state: AtemState): void {
    const mixEffect = state.video.mixEffects[this.options.mixEffect]
    if (!mixEffect) {
      return
    }

    const nextSnapshot: SwitcherSnapshot = {
      connected: true,
      source: 'atem',
      modelName:
        this.options.modelNameOverride ??
        state.info.productIdentifier ??
        Enums.Model[state.info.model] ??
        'ATEM',
      inputs: extractInputs(state, this.options.fallbackInputs ?? []),
      programInput: mixEffect.programInput,
      previewInput: mixEffect.previewInput,
      programTallyInputs: extractVisibleInputs(
        'program',
        state,
        this.options.mixEffect,
        mixEffect.programInput
      ),
      previewTallyInputs: extractVisibleInputs(
        'preview',
        state,
        this.options.mixEffect,
        mixEffect.previewInput
      ),
      autoSwitching: false,
      cycleCount: this.stateChangeCount,
      updatedAt: new Date().toISOString()
    }

    const previousProgramInput = this.snapshot.programInput
    const previousPreviewInput = this.snapshot.previewInput
    this.snapshot = nextSnapshot
    this.stateChangeCount += 1

    this.emit('stateChanged', this.getSnapshot(), {
      reason: this.stateChangeCount === 1 ? 'initial' : 'cut',
      previousProgramInput,
      previousPreviewInput
    })
  }

  private emitState(reason: SwitcherChange['reason']): void {
    this.emit('stateChanged', this.getSnapshot(), {
      reason,
      previousProgramInput: this.snapshot.programInput,
      previousPreviewInput: this.snapshot.previewInput
    })
  }

  private async waitForHydratedState(): Promise<AtemState | undefined> {
    const deadline = Date.now() + 5000

    while (Date.now() < deadline) {
      const state = this.atem.state
      if (state?.video.mixEffects[this.options.mixEffect]) {
        return state
      }

      await sleep(100)
    }

    return this.atem.state
  }
}

function extractInputs(state: AtemState, fallbackInputs: SwitcherInput[]): SwitcherInput[] {
  const inputs = Object.values(state.inputs)
    .filter((input): input is NonNullable<typeof input> => Boolean(input))
    .map((input) => ({
      id: input.inputId,
      name: input.shortName.trim() || `Input ${input.inputId}`,
      longName: input.longName.trim() || input.shortName.trim() || `Input ${input.inputId}`,
      tallyChannel: input.inputId
    }))
    .sort((left, right) => left.id - right.id)

  return inputs.length > 0 ? inputs : fallbackInputs
}

function extractVisibleInputs(
  mode: 'program' | 'preview',
  state: AtemState,
  mixEffect: number,
  fallbackInput: number
): number[] {
  return normalizeTallyInputs(listVisibleInputs(mode, state, mixEffect), fallbackInput)
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}
