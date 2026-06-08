import Fastify from 'fastify'
import cors from '@fastify/cors'
import { validateEnv } from './lib/env.js'
import { rabbitmqPlugin } from './plugins/rabbitmq.js'
import { redisPlugin } from './plugins/redis.js'
import { startTdeeWorker } from './modules/tdee-calculator/index.js'
import { startMealAnalyzerWorker } from './modules/meal-analyzer/index.js'
import { startChatWorker } from './modules/chatbot/chat.worker.js'
import { startChatDataResultConsumer } from './queues/chat-data-result.consumer.js'
import { startRagIndexWorker } from './modules/rag/rag.indexer.js'
import { startPlanAdvisorWorker } from './modules/plan-advisor/index.js'
import { startPlanAdvisorCron } from './modules/plan-advisor/plan-advisor.cron.js'
import { startWorkoutPlanGeneratorWorker } from './modules/workout-plan-generator/index.js'
import { startWeeklyRecapWorker } from './modules/weekly-recap/index.js'

validateEnv()

const server = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
})

await server.register(cors, { origin: false })
await server.register(redisPlugin)
await server.register(rabbitmqPlugin)

server.get('/health', async () => {
  const [rabbitmqStatus, redisStatus] = await Promise.all([
    Promise.resolve(server.amqp.checkQueue('tdee.calculation.request'))
      .then(() => 'ok')
      .catch(() => 'error'),
    server.redis
      .ping()
      .then(() => 'ok')
      .catch(() => 'error'),
  ])

  return {
    status: 'ok',
    service: 'ai-service',
    timestamp: new Date().toISOString(),
    rabbitmq: rabbitmqStatus,
    redis: redisStatus,
  }
})

server.addHook('onReady', async () => {
  startTdeeWorker(server.amqp)
  startMealAnalyzerWorker(server.amqp, server.redis)
  startChatWorker(server.amqp, server.redis)
  startChatDataResultConsumer(server.amqp)
  startRagIndexWorker(server.amqp)
  startPlanAdvisorWorker(server.amqp, server.redis)
  startPlanAdvisorCron(server.amqp, server.redis)
  startWorkoutPlanGeneratorWorker(server.amqp)
  startWeeklyRecapWorker(server.amqp)
})

const port = Number(process.env.PORT ?? 3001)
await server.listen({ port, host: '0.0.0.0' })
