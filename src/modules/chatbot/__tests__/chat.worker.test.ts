import { vi, describe, it, expect, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'

// ── Mock graph and context builder ────────────────────────────────────────────

const { mockGraphInvoke, mockBuildUserContext } = vi.hoisted(() => ({
  mockGraphInvoke: vi.fn(),
  mockBuildUserContext: vi.fn().mockResolvedValue(null),
}))

vi.mock('../chatbot.graph.js', () => ({
  chatbotGraph: { invoke: mockGraphInvoke },
}))

vi.mock('../../context-builder/context-builder.js', () => ({
  buildUserContext: mockBuildUserContext,
}))

import { startChatWorker } from '../chat.worker.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function buildMockChannel() {
  return {
    prefetch: vi.fn(),
    consume: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn(),
  } as unknown as Channel & {
    consume: ReturnType<typeof vi.fn>
    ack: ReturnType<typeof vi.fn>
    nack: ReturnType<typeof vi.fn>
    publish: ReturnType<typeof vi.fn>
  }
}

function buildMockRedis(): Redis {
  return { get: vi.fn().mockResolvedValue(null), set: vi.fn() } as unknown as Redis
}

function makeMsg(content = 'How do I build muscle?', retryCount = 0): ConsumeMessage {
  return {
    content: Buffer.from(
      JSON.stringify({
        correlationId: 'corr-1',
        payload: { sessionId: 'sess-1', userId: 'u1', messageId: 'msg-1', content },
      }),
    ),
    properties: { headers: retryCount > 0 ? { 'x-retry-count': retryCount } : {} },
  } as unknown as ConsumeMessage
}

async function invokeHandler(
  channel: ReturnType<typeof buildMockChannel>,
  redis: Redis,
  msg: ConsumeMessage | null,
) {
  startChatWorker(channel as unknown as Channel, redis)
  const [, handler] = channel.consume.mock.calls[0] as [
    string,
    (msg: ConsumeMessage | null) => Promise<void>,
  ]
  await handler(msg)
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockBuildUserContext.mockResolvedValue(null)
  mockGraphInvoke.mockResolvedValue({ messages: [] })
})

describe('startChatWorker', () => {
  it('registers consumer on chat.message.request queue', () => {
    const channel = buildMockChannel()
    startChatWorker(channel as unknown as Channel, buildMockRedis())
    expect(channel.consume).toHaveBeenCalledWith('chat.message.request', expect.any(Function))
  })

  it('sets prefetch to 5', () => {
    const channel = buildMockChannel()
    startChatWorker(channel as unknown as Channel, buildMockRedis())
    expect(channel.prefetch).toHaveBeenCalledWith(5)
  })

  it('returns immediately on null message', async () => {
    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), null)
    expect(channel.ack).not.toHaveBeenCalled()
  })

  it('nacks on malformed JSON without invoking graph', async () => {
    const channel = buildMockChannel()
    const badMsg = {
      content: Buffer.from('{bad}'),
      properties: { headers: {} },
    } as unknown as ConsumeMessage
    await invokeHandler(channel, buildMockRedis(), badMsg)
    expect(channel.nack).toHaveBeenCalledWith(badMsg, false, false)
    expect(mockGraphInvoke).not.toHaveBeenCalled()
  })

  it('successful graph invoke: publishes chat.response done envelope and acks', async () => {
    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), makeMsg())
    // Verify done envelope published
    const publishCalls = channel.publish.mock.calls
    const donePub = publishCalls.find((c) => {
      const env = JSON.parse((c[2] as Buffer).toString())
      return env.payload?.type === 'done'
    })
    expect(donePub).toBeDefined()
    expect(channel.ack).toHaveBeenCalled()
  })

  it('done envelope includes full assistant content from graph result', async () => {
    mockGraphInvoke.mockResolvedValue({
      messages: [new AIMessage('Build progressive overload into your programme.')],
    })
    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), makeMsg())

    const donePub = channel.publish.mock.calls.find((c) => {
      const env = JSON.parse((c[2] as Buffer).toString())
      return env.payload?.type === 'done'
    })
    expect(donePub).toBeDefined()
    const env = JSON.parse((donePub![2] as Buffer).toString())
    expect(env.payload.content).toBe('Build progressive overload into your programme.')
  })

  it('done envelope prefers streamed tokens when graph messages are plain objects', async () => {
    mockGraphInvoke.mockImplementation(
      async (state: { streamCallback?: ((t: string) => void) | null }) => {
        state.streamCallback?.('Streamed ')
        state.streamCallback?.('reply.')
        return { messages: [{ type: 'ai', content: '' }] }
      },
    )
    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), makeMsg())

    const donePub = channel.publish.mock.calls.find((c) => {
      const env = JSON.parse((c[2] as Buffer).toString())
      return env.payload?.type === 'done'
    })
    const env = JSON.parse((donePub![2] as Buffer).toString())
    expect(env.payload.content).toBe('Streamed reply.')
  })

  it('streaming: streamCallback triggers chunk publish', async () => {
    mockGraphInvoke.mockImplementation(
      async (state: { streamCallback?: ((t: string) => void) | null }) => {
        if (state.streamCallback) {
          state.streamCallback('Hello')
          state.streamCallback(' world')
        }
        return { messages: [] }
      },
    )

    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), makeMsg())

    const chunkPublishes = channel.publish.mock.calls.filter((c) => {
      const env = JSON.parse((c[2] as Buffer).toString())
      return env.payload?.type === 'chunk'
    })
    expect(chunkPublishes.length).toBe(2)
    const tokens = chunkPublishes.map((c) => JSON.parse((c[2] as Buffer).toString()).payload.token)
    expect(tokens).toContain('Hello')
    expect(tokens).toContain(' world')
  })

  it('graph throws with retry < 3: publishes error envelope and nacks without requeue', async () => {
    mockGraphInvoke.mockRejectedValue(new Error('LLM rate limit'))
    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), makeMsg('test', 1))

    const errorPub = channel.publish.mock.calls.find((c) => {
      const env = JSON.parse((c[2] as Buffer).toString())
      return env.payload?.type === 'error'
    })
    expect(errorPub).toBeDefined()
    expect(channel.nack).toHaveBeenCalled()
    expect(channel.ack).not.toHaveBeenCalled()
  })

  it('graph throws with retry >= 3: still nacks', async () => {
    mockGraphInvoke.mockRejectedValue(new Error('persistent failure'))
    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), makeMsg('test', 3))
    expect(channel.nack).toHaveBeenCalled()
    expect(channel.ack).not.toHaveBeenCalled()
  })

  it('invokes chatbotGraph with correct sessionId and streamCallback', async () => {
    const channel = buildMockChannel()
    await invokeHandler(channel, buildMockRedis(), makeMsg())
    expect(mockGraphInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        streamCallback: expect.any(Function),
      }),
      expect.objectContaining({
        configurable: expect.objectContaining({ thread_id: 'sess-1' }),
      }),
    )
  })
})
