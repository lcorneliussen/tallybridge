import type { SwitcherSnapshot } from './types.js'

export function isProgramTallyInput(snapshot: SwitcherSnapshot, inputId: number): boolean {
  return snapshot.programTallyInputs.includes(inputId) || snapshot.programInput === inputId
}

export function isPreviewTallyInput(snapshot: SwitcherSnapshot, inputId: number): boolean {
  return snapshot.previewTallyInputs.includes(inputId) || snapshot.previewInput === inputId
}

export function normalizeTallyInputs(inputIds: number[], fallbackInputId: number): number[] {
  const normalized = inputIds.filter((inputId) => Number.isInteger(inputId) && inputId > 0)
  if (normalized.length === 0 && fallbackInputId > 0) {
    normalized.push(fallbackInputId)
  }

  return Array.from(new Set(normalized)).sort((left, right) => left - right)
}
