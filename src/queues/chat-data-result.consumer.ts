import type { Channel, ConsumeMessage } from 'amqplib'
import type { ChatDataResult } from './job.types.js'
import { resolveChatDataRpcResult } from '../modules/chatbot/tools/core-service-rpc.client.js'

interface ChatDataResultEnvelope {
  correlationId: string
  payload: ChatDataResult
}

export function startChatDataResultConsumer(channel: Channel): void {
  channel.consume('chat.data.result', async (msg: ConsumeMessage | null) => {
    if (!msg) return

    try {
      const envelope = JSON.parse(msg.content.toString()) as ChatDataResultEnvelope
      resolveChatDataRpcResult(envelope.payload)
      channel.ack(msg)
    } catch {
      channel.nack(msg, false, false)
    }
  })
}
