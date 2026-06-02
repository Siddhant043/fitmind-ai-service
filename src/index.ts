import Fastify from 'fastify'
import cors from '@fastify/cors'

const server = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
})

await server.register(cors, { origin: false })

server.get('/health', async () => ({
  status: 'ok',
  service: 'ai-service',
  timestamp: new Date().toISOString(),
}))

const port = Number(process.env.PORT ?? 3001)
await server.listen({ port, host: '0.0.0.0' })
