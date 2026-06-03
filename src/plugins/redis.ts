import fp from 'fastify-plugin'
import Redis from 'ioredis'
import type { FastifyInstance } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

export const redisPlugin = fp(async (app: FastifyInstance) => {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

  client.on('error', (err) => app.log.error({ err }, '[redis] connection error'))

  app.decorate('redis', client)
  app.addHook('onClose', async () => client.quit())
})
