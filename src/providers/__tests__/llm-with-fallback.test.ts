import { describe, it, expect, vi } from 'vitest'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import { invokeWithFallback } from '../llm-with-fallback.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function mockModel(invokeImpl: () => Promise<unknown>): BaseChatModel {
  return { invoke: vi.fn().mockImplementation(invokeImpl) } as unknown as BaseChatModel
}

const MESSAGES = [] as BaseMessage[]
const PRIMARY_RESULT = { content: 'primary response' }
const FALLBACK_RESULT = { content: 'fallback response' }

// ── tests ─────────────────────────────────────────────────────────────────────

describe('invokeWithFallback', () => {
  it('returns primary result when primary succeeds', async () => {
    const primary = mockModel(async () => PRIMARY_RESULT)
    const fallback = mockModel(async () => FALLBACK_RESULT)

    const result = await invokeWithFallback(primary, fallback, MESSAGES)

    expect(result).toBe(PRIMARY_RESULT)
    expect(fallback.invoke).not.toHaveBeenCalled()
  })

  it('returns fallback result when primary throws and fallback is provided', async () => {
    const primary = mockModel(async () => {
      throw new Error('rate limit')
    })
    const fallback = mockModel(async () => FALLBACK_RESULT)

    const result = await invokeWithFallback(primary, fallback, MESSAGES)

    expect(result).toBe(FALLBACK_RESULT)
    expect(fallback.invoke).toHaveBeenCalledOnce()
  })

  it('rethrows primary error when fallback is null', async () => {
    const primaryError = new Error('primary unavailable')
    const primary = mockModel(async () => {
      throw primaryError
    })

    await expect(invokeWithFallback(primary, null, MESSAGES)).rejects.toThrow('primary unavailable')
  })

  it('throws fallback error when both models fail', async () => {
    const primary = mockModel(async () => {
      throw new Error('primary error')
    })
    const fallback = mockModel(async () => {
      throw new Error('fallback error')
    })

    await expect(invokeWithFallback(primary, fallback, MESSAGES)).rejects.toThrow('fallback error')
  })

  it('passes messages array to the invoked model', async () => {
    const msgs = [{ role: 'user', content: 'hello' }] as unknown as BaseMessage[]
    const primary = mockModel(async () => PRIMARY_RESULT)
    const fallback = mockModel(async () => FALLBACK_RESULT)

    await invokeWithFallback(primary, fallback, msgs)

    expect(primary.invoke).toHaveBeenCalledWith(msgs)
  })

  it('passes messages to fallback when primary fails', async () => {
    const msgs = [{ role: 'user', content: 'hello' }] as unknown as BaseMessage[]
    const primary = mockModel(async () => {
      throw new Error('fail')
    })
    const fallback = mockModel(async () => FALLBACK_RESULT)

    await invokeWithFallback(primary, fallback, msgs)

    expect(fallback.invoke).toHaveBeenCalledWith(msgs)
  })
})
