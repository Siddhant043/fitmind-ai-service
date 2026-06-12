import fp from 'fastify-plugin'
import amqp from 'amqplib'
import type { Channel } from 'amqplib'
import type { FastifyInstance } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    amqp: Channel
  }
}

const EXCHANGES = [
  { name: 'fitmind.direct', type: 'direct' },
  { name: 'fitmind.topic', type: 'topic' },
  { name: 'fitmind.dlx', type: 'direct' },
] as const

const QUEUES: Array<{ name: string; args?: Record<string, unknown> }> = [
  { name: 'meal.analysis.request', args: { 'x-max-priority': 9 } },
  { name: 'meal.analysis.result' },
  { name: 'chat.message.request' },
  { name: 'chat.message.response' },
  { name: 'chat.data.request' },
  { name: 'chat.data.result' },
  { name: 'plan.analysis.trigger' },
  { name: 'plan.suggestion.result' },
  { name: 'tdee.calculation.request' },
  { name: 'tdee.calculation.result' },
  { name: 'workout.plan.generation.request' },
  { name: 'workout.plan.generation.result' },
  { name: 'weekly.recap.request' },
  { name: 'weekly.recap.result' },
  { name: 'chapter.celebration.request' },
  { name: 'chapter.celebration.result' },
  { name: 'challenge.suggestion.request' },
  { name: 'challenge.suggestion.result' },
  { name: 'rag-index' },
]

export const rabbitmqPlugin = fp(async (app: FastifyInstance) => {
  const rabbitmqUrl = process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'
  const connection = await amqp.connect(rabbitmqUrl)
  const channel = await connection.createChannel()

  for (const ex of EXCHANGES) {
    await channel.assertExchange(ex.name, ex.type, { durable: true })
  }

  for (const q of QUEUES) {
    await channel.assertQueue(q.name, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'fitmind.dlx',
        ...q.args,
      },
    })
  }

  const bindings = [
    { queue: 'meal.analysis.request', exchange: 'fitmind.direct', routingKey: 'meal.analyze' },
    { queue: 'meal.analysis.result', exchange: 'fitmind.direct', routingKey: 'meal.result' },
    { queue: 'chat.message.request', exchange: 'fitmind.direct', routingKey: 'chat.request' },
    { queue: 'chat.message.response', exchange: 'fitmind.direct', routingKey: 'chat.response' },
    { queue: 'chat.data.request', exchange: 'fitmind.direct', routingKey: 'chat.data.request' },
    { queue: 'chat.data.result', exchange: 'fitmind.direct', routingKey: 'chat.data.result' },
    { queue: 'plan.analysis.trigger', exchange: 'fitmind.direct', routingKey: 'plan.trigger' },
    { queue: 'plan.suggestion.result', exchange: 'fitmind.direct', routingKey: 'plan.result' },
    { queue: 'tdee.calculation.request', exchange: 'fitmind.direct', routingKey: 'tdee.calculate' },
    { queue: 'tdee.calculation.result', exchange: 'fitmind.direct', routingKey: 'tdee.result' },
    {
      queue: 'workout.plan.generation.request',
      exchange: 'fitmind.direct',
      routingKey: 'workout.plan.generate',
    },
    {
      queue: 'workout.plan.generation.result',
      exchange: 'fitmind.direct',
      routingKey: 'workout.plan.result',
    },
    { queue: 'weekly.recap.request', exchange: 'fitmind.direct', routingKey: 'recap.request' },
    { queue: 'weekly.recap.result', exchange: 'fitmind.direct', routingKey: 'recap.result' },
    {
      queue: 'chapter.celebration.request',
      exchange: 'fitmind.direct',
      routingKey: 'chapter.celebration.request',
    },
    {
      queue: 'chapter.celebration.result',
      exchange: 'fitmind.direct',
      routingKey: 'chapter.celebration.result',
    },
    {
      queue: 'challenge.suggestion.request',
      exchange: 'fitmind.direct',
      routingKey: 'challenge.suggestion.request',
    },
    {
      queue: 'challenge.suggestion.result',
      exchange: 'fitmind.direct',
      routingKey: 'challenge.suggestion.result',
    },
  ]

  for (const b of bindings) {
    await channel.bindQueue(b.queue, b.exchange, b.routingKey)
  }

  app.decorate('amqp', channel)

  app.addHook('onClose', async () => {
    await channel.close()
    await connection.close()
  })
})
