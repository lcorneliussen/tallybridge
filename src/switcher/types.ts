export interface SwitcherInput {
  id: number
  name: string
  longName: string
  tallyChannel: number
}

export interface SwitcherSnapshot {
  connected: boolean
  source: 'simulator' | 'atem'
  modelName: string
  inputs: SwitcherInput[]
  programInput: number
  previewInput: number
  programTallyInputs: number[]
  previewTallyInputs: number[]
  autoSwitching: boolean
  cycleCount: number
  updatedAt: string
}

export interface SwitcherChange {
  reason:
    | 'initial'
    | 'set-program'
    | 'set-preview'
    | 'cut'
    | 'auto-start'
    | 'auto-stop'
    | 'auto-step'
  previousProgramInput: number
  previousPreviewInput: number
}
