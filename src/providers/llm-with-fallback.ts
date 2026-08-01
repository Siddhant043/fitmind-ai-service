import type { BaseMessage } from '@langchain/core/messages'
import type { AIMessageChunk } from '@langchain/core/messages'

const TRANSIENT_LLM_MAX_ATTEMPTS = 3

/**
 * Structural chat-model surface used by fallback helpers.
 * Accepts both BaseChatModel and tool-bound Runnables from `bindTools()`.
 */
export type InvokableLlm = {
  invoke: (messages: BaseMessage[]) => Promise<unknown>
}

export type StreamableLlm = {
  stream: (
    messages: BaseMessage[],
  ) =>
    | AsyncIterable<AIMessageChunk | { content?: unknown }>
    | Promise<AsyncIterable<AIMessageChunk | { content?: unknown }>>
}

export function isTransientLlmError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\b503\b|429|\b500\b|Service Unavailable|high demand|rate limit|overloaded|temporarily busy/i.test(
    message,
  )
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function invokeWithTransientRetries(
  model: InvokableLlm,
  messages: BaseMessage[],
  label: string,
): Promise<unknown> {
  let lastErr: unknown

  for (let attempt = 0; attempt < TRANSIENT_LLM_MAX_ATTEMPTS; attempt++) {
    try {
      return await model.invoke(messages)
    } catch (err) {
      lastErr = err
      const isLastAttempt = attempt === TRANSIENT_LLM_MAX_ATTEMPTS - 1
      if (!isTransientLlmError(err) || isLastAttempt) throw err

      const delayMs = 1000 * (attempt + 1)
      console.warn(
        `[LLM] ${label} transient error, retrying (${attempt + 1}/${TRANSIENT_LLM_MAX_ATTEMPTS}):`,
        err instanceof Error ? err.message : err,
      )
      await delay(delayMs)
    }
  }

  throw lastErr
}

export async function invokeWithFallback(
  primary: InvokableLlm,
  fallback: InvokableLlm | null,
  messages: BaseMessage[],
): Promise<unknown> {
  try {
    return await invokeWithTransientRetries(primary, messages, 'primary')
  } catch (err) {
    if (!fallback) throw err
    console.warn('[LLM] Primary model failed, retrying with fallback:', (err as Error).message)
    return invokeWithTransientRetries(fallback, messages, 'fallback')
  }
}

export async function streamWithFallback(
  primary: StreamableLlm,
  fallback: StreamableLlm | null,
  messages: BaseMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  const streamFromModel = async (model: StreamableLlm, _label: string): Promise<string> => {
    let fullContent = ''
    const stream = await model.stream(messages)
    for await (const chunk of stream) {
      const token = extractStreamToken(chunk)
      if (token) {
        fullContent += token
        onToken(token)
      }
    }
    return fullContent
  }

  const streamWithTransientRetries = async (
    model: StreamableLlm,
    label: string,
  ): Promise<string> => {
    let lastErr: unknown

    for (let attempt = 0; attempt < TRANSIENT_LLM_MAX_ATTEMPTS; attempt++) {
      try {
        return await streamFromModel(model, label)
      } catch (err) {
        lastErr = err
        const isLastAttempt = attempt === TRANSIENT_LLM_MAX_ATTEMPTS - 1
        if (!isTransientLlmError(err) || isLastAttempt) throw err

        const delayMs = 1000 * (attempt + 1)
        console.warn(
          `[LLM] ${label} stream transient error, retrying (${attempt + 1}/${TRANSIENT_LLM_MAX_ATTEMPTS}):`,
          err instanceof Error ? err.message : err,
        )
        await delay(delayMs)
      }
    }

    throw lastErr
  }

  try {
    return await streamWithTransientRetries(primary, 'primary')
  } catch (err) {
    if (!fallback) throw err
    console.warn('[LLM] Primary stream failed, retrying with fallback:', (err as Error).message)
    return streamWithTransientRetries(fallback, 'fallback')
  }
}

function extractStreamToken(chunk: AIMessageChunk | { content?: unknown }): string {
  return typeof chunk.content === 'string' ? chunk.content : ''
}
