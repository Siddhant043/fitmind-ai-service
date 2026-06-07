import { randomUUID } from 'crypto'
import type { Channel } from 'amqplib'
import type { Redis } from 'ioredis'
import type {
  ChatDataRequest,
  ChatDataResult,
  ChatDataToolName,
} from '../../../queues/job.types.js'

const RPC_TIMEOUT_MS = 5000
const RPC_REDIS_TTL_SECONDS = 30

type PendingEntry = {
  resolve: (result: ChatDataResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const pendingByCorrelationId = new Map<string, PendingEntry>()

export function resolveChatDataRpcResult(result: ChatDataResult): void {
  const pending = pendingByCorrelationId.get(result.correlationId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingByCorrelationId.delete(result.correlationId)
  pending.resolve(result)
}

export function rejectAllChatDataRpc(error: Error): void {
  for (const [correlationId, pending] of pendingByCorrelationId.entries()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
    pendingByCorrelationId.delete(correlationId)
  }
}

function waitForChatDataResult(correlationId: string): Promise<ChatDataResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingByCorrelationId.delete(correlationId)
      reject(new Error(`Chat data RPC timed out after ${RPC_TIMEOUT_MS}ms`))
    }, RPC_TIMEOUT_MS)

    pendingByCorrelationId.set(correlationId, { resolve, reject, timeout })
  })
}

export async function fetchChatData(
  channel: Channel,
  redis: Redis,
  userId: string,
  tool: ChatDataToolName,
  args: ChatDataRequest['args'],
): Promise<unknown> {
  const correlationId = randomUUID()
  const resultPromise = waitForChatDataResult(correlationId)

  await redis.set(
    `chat_data_pending:${correlationId}`,
    JSON.stringify({ userId, tool, startedAt: new Date().toISOString() }),
    'EX',
    RPC_REDIS_TTL_SECONDS,
  )

  const envelope = {
    messageId: randomUUID(),
    correlationId,
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'chat.data.request',
    payload: { userId, tool, args } satisfies ChatDataRequest,
    metadata: { userId, traceId: correlationId },
  }

  channel.publish('fitmind.direct', 'chat.data.request', Buffer.from(JSON.stringify(envelope)), {
    persistent: false,
  })

  const result = await resultPromise
  await redis.del(`chat_data_pending:${correlationId}`).catch(() => {})

  if (result.status === 'failed') {
    throw new Error(result.errorMessage ?? 'Chat data request failed')
  }

  return result.result
}
