import { Enums } from 'atem-connection'

import type { SwitcherInput, SwitcherSnapshot } from '../switcher/types.js'

export interface AtemIdentityConfig {
  productIdentifier: string
  model: keyof typeof Enums.Model
  protocolVersion: keyof typeof Enums.ProtocolVersion
  videoMode: keyof typeof Enums.VideoMode
}

export function buildInitialStateCommands(
  snapshot: SwitcherSnapshot,
  identity: AtemIdentityConfig
): Buffer[] {
  return [
    encodeCommand('_ver', encodeVersion(identity.protocolVersion)),
    encodeCommand('_pin', encodeProductIdentifier(identity.productIdentifier, identity.model)),
    encodeCommand('_top', encodeTopology(snapshot.inputs)),
    encodeCommand('_MeC', encodeMixEffectConfig()),
    encodeCommand('_mpl', encodeMediaPoolConfig()),
    encodeCommand('VidM', encodeVideoMode(identity.videoMode)),
    ...snapshot.inputs.map((input) => encodeCommand('InPr', encodeInputProperties(input))),
    encodeCommand('PrgI', encodeProgramInput(snapshot.programInput)),
    encodeCommand('PrvI', encodePreviewInput(snapshot.previewInput)),
    encodeCommand('TlSr', encodeTallyBySource(snapshot)),
    encodeCommand('InCm', Buffer.alloc(0)),
    encodeCommand('Powr', encodePowerStatus())
  ]
}

export function buildStateChangeCommands(snapshot: SwitcherSnapshot): Buffer[] {
  return [
    encodeCommand('PrgI', encodeProgramInput(snapshot.programInput)),
    encodeCommand('PrvI', encodePreviewInput(snapshot.previewInput)),
    encodeCommand('TlSr', encodeTallyBySource(snapshot))
  ]
}

function encodeVersion(protocolVersion: keyof typeof Enums.ProtocolVersion): Buffer {
  const payload = Buffer.alloc(4)
  payload.writeUInt32BE(Enums.ProtocolVersion[protocolVersion], 0)
  return payload
}

function encodeProductIdentifier(
  productIdentifier: string,
  model: keyof typeof Enums.Model
): Buffer {
  const payload = Buffer.alloc(41)
  payload.write(productIdentifier.slice(0, 39), 0, 'ascii')
  payload.writeUInt8(Enums.Model[model], 40)
  return payload
}

function encodeTopology(inputs: SwitcherInput[]): Buffer {
  const payload = Buffer.alloc(24)
  payload.writeUInt8(1, 0)
  payload.writeUInt8(Math.max(inputs.length, 1), 1)
  payload.writeUInt8(0, 2)
  payload.writeUInt8(0, 3)
  payload.writeUInt8(0, 4)
  payload.writeUInt8(0, 5)
  payload.writeUInt8(1, 6)
  payload.writeUInt8(0, 7)
  payload.writeUInt8(0, 8)
  payload.writeUInt8(0, 9)
  payload.writeUInt8(0, 10)
  payload.writeUInt8(0, 11)
  payload.writeUInt8(0, 13)
  payload.writeUInt8(0, 18)
  payload.writeUInt8(0, 22)
  payload.writeUInt8(0, 23)
  return payload
}

function encodeMixEffectConfig(): Buffer {
  return Buffer.from([0x00, 0x01])
}

function encodeMediaPoolConfig(): Buffer {
  return Buffer.from([0x00, 0x00])
}

function encodeVideoMode(videoMode: keyof typeof Enums.VideoMode): Buffer {
  const payload = Buffer.alloc(4)
  payload.writeUInt8(Enums.VideoMode[videoMode], 0)
  return payload
}

function encodeInputProperties(input: SwitcherInput): Buffer {
  const payload = Buffer.alloc(36)
  payload.writeUInt16BE(input.id, 0)
  payload.write(input.longName.slice(0, 20), 2, 'ascii')
  payload.write(input.name.slice(0, 4), 22, 'ascii')
  payload.writeUInt8(0, 26)
  payload.writeUInt16BE(Enums.ExternalPortType.SDI, 28)
  payload.writeUInt16BE(Enums.ExternalPortType.SDI, 30)
  payload.writeUInt8(Enums.InternalPortType.External, 32)
  payload.writeUInt8(0, 33)
  payload.writeUInt8(Enums.SourceAvailability.All, 34)
  payload.writeUInt8(Enums.MeAvailability.All, 35)
  return payload
}

function encodeProgramInput(inputId: number): Buffer {
  const payload = Buffer.alloc(4)
  payload.writeUInt8(0, 0)
  payload.writeUInt16BE(inputId, 2)
  return payload
}

function encodePreviewInput(inputId: number): Buffer {
  const payload = Buffer.alloc(4)
  payload.writeUInt8(0, 0)
  payload.writeUInt16BE(inputId, 2)
  return payload
}

function encodeTallyBySource(snapshot: SwitcherSnapshot): Buffer {
  const payload = Buffer.alloc(2 + snapshot.inputs.length * 3)
  payload.writeUInt16BE(snapshot.inputs.length, 0)

  snapshot.inputs.forEach((input, index) => {
    const offset = 2 + index * 3
    payload.writeUInt16BE(input.id, offset)

    let flags = 0
    if (input.id === snapshot.programInput) {
      flags |= 0x01
    }
    if (input.id === snapshot.previewInput) {
      flags |= 0x02
    }

    payload.writeUInt8(flags, offset + 2)
  })

  return payload
}

function encodePowerStatus(): Buffer {
  return Buffer.from([0x01])
}

function encodeCommand(rawName: string, payload: Buffer): Buffer {
  const commandLength = 8 + payload.length
  const command = Buffer.alloc(commandLength)
  command.writeUInt16BE(commandLength, 0)
  command.write(rawName, 4, 4, 'ascii')
  payload.copy(command, 8)
  return command
}
