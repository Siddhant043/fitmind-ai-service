import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Channel, ConsumeMessage } from 'amqplib'
import { startChatDataResultConsumer } from '../chat-data-result.consumer.js'

vi.mock('../../modules/chatbot/tools/core-service-rpc.client.js', () => ({
  resolveChatDataRpcResult: vi.fn(),
}))

import { resolveChatDataRpcResult } from '../../modules/chatbot/tools/core-service-rpc.client.js'

describe('startChatDataResultConsumer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers consumer on chat.data.result queue', () => {
    const consume = vi.fn()
    const channel = { consume, prefetch: vi.fn() } as unknown as Channel
    startChatDataResultConsumer(channel)
    expect(consume).toHaveBeenCalledWith('chat.data.result', expect.any(Function))
  })

  it('resolves pending RPC when a valid message arrives', async () => {
    const ack = vi.fn()
    const consume = vi.fn()
    const channel = { consume, ack, nack: vi.fn() } as unknown as Channel
    startChatDataResultConsumer(channel)

    const handler = consume.mock.calls[0]?.[1] as (msg: ConsumeMessage | null) => Promise<void>
    await handler({
      content: Buffer.from(
        JSON.stringify({
          correlationId: 'corr-1',
          payload: {
            correlationId: 'corr-1',
            status: 'completed',
            result: { ok: true },
            errorMessage: null,
          },
        }),
      ),
    } as ConsumeMessage)

    expect(resolveChatDataRpcResult).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr-1', status: 'completed' }),
    )
    expect(ack).toHaveBeenCalled()
  })
})
