import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'
import { HumanMessage } from '@langchain/core/messages'
import { chatbotGraph } from './chatbot.graph.js'
import { buildUserContext } from '../context-builder/context-builder.js'

interface ChatMessageRequest {
  sessionId: string
  userId: string
  messageId: string
  content: string
  imageUrl?: string | null
}

function publishChunk(
  channel: Channel,
  userId: string,
  sessionId: string,
  token: string,
  correlationId: string,
): void {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'chat.message.response',
    payload: { userId, sessionId, type: 'chunk', token },
    metadata: { userId },
  }
  channel.publish('fitmind.direct', 'chat.response', Buffer.from(JSON.stringify(envelope)), {
    persistent: false,
  })
}

function publishDone(
  channel: Channel,
  userId: string,
  sessionId: string,
  correlationId: string,
): void {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'chat.message.response',
    payload: { userId, sessionId, type: 'done' },
    metadata: { userId },
  }
  channel.publish('fitmind.direct', 'chat.response', Buffer.from(JSON.stringify(envelope)), {
    persistent: false,
  })
}

function publishError(
  channel: Channel,
  userId: string,
  sessionId: string,
  error: string,
  correlationId: string,
): void {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'chat.message.response',
    payload: { userId, sessionId, type: 'error', error },
    metadata: { userId },
  }
  channel.publish('fitmind.direct', 'chat.response', Buffer.from(JSON.stringify(envelope)), {
    persistent: false,
  })
}

export function startChatWorker(channel: Channel, redis: Redis) {
  channel.prefetch(5)

  channel.consume('chat.message.request', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    let envelope: { payload: ChatMessageRequest; correlationId: string }
    try {
      envelope = JSON.parse(msg.content.toString())
    } catch {
      channel.nack(msg, false, false)
      return
    }

    const { payload, correlationId } = envelope
    const { sessionId, userId, content } = payload

    try {
      const userContext = await buildUserContext(userId, redis)

      await chatbotGraph.invoke(
        {
          messages: [new HumanMessage(content)],
          userContext,
          sessionId,
          streamCallback: (token: string) =>
            publishChunk(channel, userId, sessionId, token, correlationId),
        },
        {
          configurable: {
            thread_id: sessionId,
            redis,
          },
        },
      )

      publishDone(channel, userId, sessionId, correlationId)
      channel.ack(msg)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      publishError(channel, userId, sessionId, errorMessage, correlationId)
      const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0) as number
      if (retryCount < 3) {
        channel.nack(msg, false, false)
      } else {
        channel.nack(msg, false, false)
      }
    }
  })
}
