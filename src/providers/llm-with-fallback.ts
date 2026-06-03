import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'

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
