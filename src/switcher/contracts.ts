import { EventEmitter } from 'node:events'

import type { SwitcherChange, SwitcherSnapshot } from './types.js'

export type SwitcherEvents = {
  stateChanged: [snapshot: SwitcherSnapshot, change: SwitcherChange]
}

export abstract class SwitcherSource extends EventEmitter<SwitcherEvents> {
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  abstract getSnapshot(): SwitcherSnapshot
}

export interface SwitcherControlSurface {
  setProgramInput(inputId: number): Promise<SwitcherSnapshot> | SwitcherSnapshot
  setPreviewInput(inputId: number): Promise<SwitcherSnapshot> | SwitcherSnapshot
  cut(): Promise<SwitcherSnapshot> | SwitcherSnapshot
}

export interface AutoSwitchingControlSurface {
  startAutoSwitching(): Promise<SwitcherSnapshot> | SwitcherSnapshot
  stopAutoSwitching(): Promise<SwitcherSnapshot> | SwitcherSnapshot
}

export function hasControlSurface(
  source: SwitcherSource
): source is SwitcherSource & SwitcherControlSurface {
  return (
    'setProgramInput' in source &&
    typeof source.setProgramInput === 'function' &&
    'setPreviewInput' in source &&
    typeof source.setPreviewInput === 'function' &&
    'cut' in source &&
    typeof source.cut === 'function'
  )
}

export function hasAutoSwitchingControlSurface(
  source: SwitcherSource
): source is SwitcherSource & SwitcherControlSurface & AutoSwitchingControlSurface {
  return (
    hasControlSurface(source) &&
    'startAutoSwitching' in source &&
    typeof source.startAutoSwitching === 'function' &&
    'stopAutoSwitching' in source &&
    typeof source.stopAutoSwitching === 'function'
  )
}
