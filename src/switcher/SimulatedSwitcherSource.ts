import {
  SwitcherSource
} from './contracts.js'
import type { SwitcherChange, SwitcherInput, SwitcherSnapshot } from './types.js'

export interface SimulatedSwitcherOptions {
  modelName: string
  inputs: SwitcherInput[]
  sequence: number[]
  intervalMs: number
  autoStart: boolean
  startProgramInput: number
  startPreviewInput: number
}

export class SimulatedSwitcherSource extends SwitcherSource {
  private readonly inputsById: Map<number, SwitcherInput>
  private readonly sequence: number[]
  private readonly intervalMs: number
  private readonly modelName: string
  private timer: NodeJS.Timeout | undefined
  private snapshot: SwitcherSnapshot

  constructor(private readonly options: SimulatedSwitcherOptions) {
    super()

    if (options.inputs.length < 2) {
      throw new Error('Simulator requires at least two inputs.')
    }

    this.inputsById = new Map(options.inputs.map((input) => [input.id, input]))
    this.sequence = this.normalizeSequence(options.sequence)
    this.intervalMs = options.intervalMs
    this.modelName = options.modelName

    const startProgramInput = this.mustResolveInput(options.startProgramInput)
    const startPreviewInput =
      options.startPreviewInput === startProgramInput
        ? this.getNextInput(startProgramInput)
        : this.mustResolveInput(options.startPreviewInput)

    this.snapshot = {
      connected: false,
      source: 'simulator',
      modelName: this.modelName,
      inputs: options.inputs,
      programInput: startProgramInput,
      previewInput: startPreviewInput,
      programTallyInputs: [startProgramInput],
      previewTallyInputs: [startPreviewInput],
      autoSwitching: false,
      cycleCount: 0,
      updatedAt: new Date().toISOString()
    }
  }

  async start(): Promise<void> {
    this.snapshot.connected = true
    this.snapshot.updatedAt = new Date().toISOString()
    this.emitState('initial')

    if (this.options.autoStart) {
      this.startAutoSwitching()
    }
  }

  async stop(): Promise<void> {
    this.stopAutoSwitching()
    this.snapshot.connected = false
    this.snapshot.updatedAt = new Date().toISOString()
  }

  getSnapshot(): SwitcherSnapshot {
    return structuredClone(this.snapshot)
  }

  setProgramInput(inputId: number): SwitcherSnapshot {
    const nextProgramInput = this.mustResolveInput(inputId)
    const nextPreviewInput =
      nextProgramInput === this.snapshot.previewInput
        ? this.getNextInput(nextProgramInput)
        : this.snapshot.previewInput

    this.applySnapshotChange({
      reason: 'set-program',
      nextProgramInput,
      nextPreviewInput
    })

    return this.getSnapshot()
  }

  setPreviewInput(inputId: number): SwitcherSnapshot {
    const nextPreviewInput = this.mustResolveInput(inputId)
    if (nextPreviewInput === this.snapshot.programInput) {
      throw new Error('Preview input cannot match the current program input.')
    }

    this.applySnapshotChange({
      reason: 'set-preview',
      nextProgramInput: this.snapshot.programInput,
      nextPreviewInput
    })

    return this.getSnapshot()
  }

  cut(): SwitcherSnapshot {
    const nextProgramInput = this.snapshot.previewInput
    const nextPreviewInput = this.getNextInput(nextProgramInput)

    this.applySnapshotChange({
      reason: 'cut',
      nextProgramInput,
      nextPreviewInput
    })

    return this.getSnapshot()
  }

  startAutoSwitching(): SwitcherSnapshot {
    if (this.timer) {
      return this.getSnapshot()
    }

    this.snapshot.autoSwitching = true
    this.snapshot.updatedAt = new Date().toISOString()
    this.emitState('auto-start')
    this.timer = setInterval(() => {
      this.advanceOnce()
    }, this.intervalMs)

    return this.getSnapshot()
  }

  stopAutoSwitching(): SwitcherSnapshot {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }

    if (this.snapshot.autoSwitching) {
      this.snapshot.autoSwitching = false
      this.snapshot.updatedAt = new Date().toISOString()
      this.emitState('auto-stop')
    }

    return this.getSnapshot()
  }

  advanceOnce(): SwitcherSnapshot {
    const nextProgramInput = this.snapshot.previewInput
    const nextPreviewInput = this.getNextInput(nextProgramInput)

    this.applySnapshotChange({
      reason: 'auto-step',
      nextProgramInput,
      nextPreviewInput,
      incrementCycleCount: true
    })

    return this.getSnapshot()
  }

  private applySnapshotChange({
    reason,
    nextProgramInput,
    nextPreviewInput,
    incrementCycleCount = false
  }: {
    reason: SwitcherChange['reason']
    nextProgramInput: number
    nextPreviewInput: number
    incrementCycleCount?: boolean
  }): void {
    if (nextProgramInput === nextPreviewInput) {
      throw new Error('Program and preview inputs must differ.')
    }

    const previousProgramInput = this.snapshot.programInput
    const previousPreviewInput = this.snapshot.previewInput

    this.snapshot.programInput = nextProgramInput
    this.snapshot.previewInput = nextPreviewInput
    this.snapshot.programTallyInputs = [nextProgramInput]
    this.snapshot.previewTallyInputs = [nextPreviewInput]
    if (incrementCycleCount) {
      this.snapshot.cycleCount += 1
    }
    this.snapshot.updatedAt = new Date().toISOString()

    this.emit('stateChanged', this.getSnapshot(), {
      reason,
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

  private mustResolveInput(inputId: number): number {
    if (!this.inputsById.has(inputId)) {
      throw new Error(`Unknown input: ${inputId}`)
    }

    return inputId
  }

  private getNextInput(currentInput: number): number {
    const currentIndex = this.sequence.indexOf(currentInput)
    if (currentIndex === -1) {
      return this.sequence[0]
    }

    return this.sequence[(currentIndex + 1) % this.sequence.length]
  }

  private normalizeSequence(sequence: number[]): number[] {
    const normalized = sequence.filter((inputId) => this.inputsById.has(inputId))
    if (normalized.length < 2) {
      throw new Error('Sequence must contain at least two configured inputs.')
    }

    return normalized
  }
}
