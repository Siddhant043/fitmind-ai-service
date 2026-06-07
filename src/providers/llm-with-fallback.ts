import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import type { AIMessageChunk } from '@langchain/core/messages'

export async function invokeWithFallback(
  primary: BaseChatModel,
  fallback: BaseChatModel | null,
  messages: BaseMessage[],
): Promise<unknown> {
  try {
    return await primary.invoke(messages)
  } catch (err) {
    if (!fallback) throw err
    console.warn('[LLM] Primary model failed, retrying with fallback:', (err as Error).message)
    return fallback.invoke(messages)
  }
}

export async function streamWithFallback(
  primary: BaseChatModel,
  fallback: BaseChatModel | null,
  messages: BaseMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  const streamFromModel = async (model: BaseChatModel): Promise<string> => {
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

  try {
    return await streamFromModel(primary)
  } catch (err) {
    if (!fallback) throw err
    console.warn('[LLM] Primary stream failed, retrying with fallback:', (err as Error).message)
    return streamFromModel(fallback)
  }
}

function extractStreamToken(chunk: AIMessageChunk | { content?: unknown }): string {
  return typeof chunk.content === 'string' ? chunk.content : ''
}
