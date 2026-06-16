import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ListenerBindContext {
  component: string
  protocol: 'tcp' | 'udp'
  host: string
  port: number
}

export class ListenerBindError extends Error {
  constructor(
    message: string,
    readonly context: ListenerBindContext,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ListenerBindError'
  }
}

export function wrapListenerError(
  error: unknown,
  context: ListenerBindContext
): ListenerBindError {
  const details = describeBindFailure(error, context)
  return new ListenerBindError(details, context, {
    cause: error instanceof Error ? error : undefined
  })
}

export async function enrichStartupErrorMessage(
  error: unknown,
  configPath?: string
): Promise<string> {
  if (error instanceof ListenerBindError) {
    const owner = await findPortOwner(error.context)
    const lines = [error.message]

    if (configPath) {
      lines.push(`Loaded config from ${configPath}`)
    }

    if (owner) {
      lines.push(`Detected existing listener: ${owner}`)
    } else {
      lines.push(
        `Port owner not detected automatically. Try: lsof -nP -i${error.context.protocol.toUpperCase()}:${error.context.port}`
      )
    }

    return lines.join('\n')
  }

  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return String(error)
}

function describeBindFailure(error: unknown, context: ListenerBindContext): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined

  if (code === 'EADDRINUSE') {
    return `${context.component} failed to bind ${context.protocol}://${context.host}:${context.port}: address already in use`
  }

  if (code === 'EACCES') {
    return `${context.component} failed to bind ${context.protocol}://${context.host}:${context.port}: permission denied`
  }

  if (error instanceof Error) {
    return `${context.component} failed to bind ${context.protocol}://${context.host}:${context.port}: ${error.message}`
  }

  return `${context.component} failed to bind ${context.protocol}://${context.host}:${context.port}`
}

async function findPortOwner(context: ListenerBindContext): Promise<string | undefined> {
  const args =
    context.protocol === 'tcp'
      ? ['-nP', `-iTCP:${context.port}`, '-sTCP:LISTEN']
      : ['-nP', `-iUDP:${context.port}`]

  try {
    const { stdout } = await execFileAsync('lsof', args)
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length < 2) {
      return undefined
    }

    return lines[1]
  } catch {
    return undefined
  }
}
