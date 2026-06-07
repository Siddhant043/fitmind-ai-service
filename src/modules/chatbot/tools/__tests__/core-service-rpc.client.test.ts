import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Channel } from 'amqplib'
import type { Redis } from 'ioredis'
import { fetchChatData, resolveChatDataRpcResult } from '../core-service-rpc.client.js'

function buildMockChannel() {
  return { publish: vi.fn() } as unknown as Channel
}

function buildMockRedis() {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as Redis
}

describe('core-service-rpc.client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetchChatData publishes request and resolves when result arrives', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis()

    const resultPromise = fetchChatData(channel, redis, 'u1', 'get_workout_session', {
      sessionId: 's1',
    })

    await Promise.resolve()

    const publishCall = (channel.publish as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(publishCall).toBeDefined()
    const publishedBody = JSON.parse(String(publishCall?.[2]))
    const correlationId = publishedBody.correlationId as string

    resolveChatDataRpcResult({
      correlationId,
      status: 'completed',
      result: { sessionId: 's1' },
      errorMessage: null,
    })

    await expect(resultPromise).resolves.toEqual({ sessionId: 's1' })
  })

  it('fetchChatData rejects when RPC times out', async () => {
    vi.useFakeTimers()
    const channel = buildMockChannel()
    const redis = buildMockRedis()

    const resultPromise = fetchChatData(channel, redis, 'u1', 'get_exercise_history', {
      exerciseName: 'bench',
    })
    const assertion = expect(resultPromise).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(5001)
    await assertion
    vi.useRealTimers()
  })

  it('fetchChatData rejects when result status is failed', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis()

    const resultPromise = fetchChatData(channel, redis, 'u1', 'get_workout_session', {})

    await Promise.resolve()
    const publishCall = (channel.publish as ReturnType<typeof vi.fn>).mock.calls[0]
    const publishedBody = JSON.parse(String(publishCall?.[2]))

    resolveChatDataRpcResult({
      correlationId: publishedBody.correlationId,
      status: 'failed',
      result: null,
      errorMessage: 'Workout session not found',
    })

    await expect(resultPromise).rejects.toThrow('Workout session not found')
  })
})
