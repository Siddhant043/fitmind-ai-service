import { randomUUID } from 'crypto'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { chatbotGraph } from './chatbot.graph.js'
import { buildUserContext } from '../context-builder/context-builder.js'
import type { WorkoutActionPayload } from './workout-action-extractor.js'

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

function isAssistantMessage(message: unknown): boolean {
  if (message instanceof AIMessage) return true
  if (!message || typeof message !== 'object') return false
  const role =
    typeof (message as { _getType?: () => string })._getType === 'function'
      ? (message as { _getType: () => string })._getType()
      : (message as { type?: string }).type
  return role === 'ai'
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return String(part.text)
      return ''
    })
    .join('')
}

function assistantContentFromGraphResult(result: { messages: unknown[] }): string {
  for (let i = result.messages.length - 1; i >= 0; i--) {
    const message = result.messages[i]
    if (!isAssistantMessage(message)) continue
    const text = textFromMessageContent((message as { content?: unknown }).content)
    if (text) return text
  }
  return ''
}

function publishDone(
  channel: Channel,
  userId: string,
  sessionId: string,
  correlationId: string,
  content: string,
  actionPayload: WorkoutActionPayload | null = null,
): void {
  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'chat.message.response',
    payload: { userId, sessionId, type: 'done', content, actionPayload },
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

function userFacingChatError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/429|quota|rate.?limit|too many requests/i.test(message)) {
    return 'The AI service is temporarily busy. Please try again in a minute.'
  }
  return message
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
      let streamedContent = ''

      const result = await chatbotGraph.invoke(
        {
          messages: [new HumanMessage(content)],
          userContext,
          sessionId,
          streamCallback: (token: string) => {
            streamedContent += token
            publishChunk(channel, userId, sessionId, token, correlationId)
          },
        },
        {
          configurable: {
            thread_id: sessionId,
            redis,
            userId,
            channel,
          },
          recursionLimit: 8,
        },
      )

      const graphContent = assistantContentFromGraphResult(result)
      const assistantContent = streamedContent.trim() || graphContent.trim()
      const actionPayload = result.workoutAction ?? null
      publishDone(channel, userId, sessionId, correlationId, assistantContent, actionPayload)
      channel.ack(msg)
    } catch (err) {
      const errorMessage = userFacingChatError(err)
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
