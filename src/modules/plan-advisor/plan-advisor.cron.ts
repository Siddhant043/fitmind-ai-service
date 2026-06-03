import cron from 'node-cron'
import { randomUUID } from 'crypto'
import type { Channel } from 'amqplib'
import type { Redis } from 'ioredis'

// Fires at 2:00 AM every day.
// Scans Redis for all user_context:* keys (written by core-service after every
// profile/workout/nutrition change). For each key that has enough data (at least
// a recentSessions or recentNutrition array), publishes a plan.analysis.trigger
// message so the plan-advisor worker can analyse and generate suggestions.
export function startPlanAdvisorCron(channel: Channel, redis: Redis): void {
  cron.schedule('0 2 * * *', async () => {
    try {
      const keys = await redis.keys('user_context:*')
      if (keys.length === 0) return

      for (const key of keys) {
        const userId = key.replace('user_context:', '')
        if (!userId) continue

        const raw = await redis.get(key)
        if (!raw) continue

        let ctx: { recentSessions?: unknown[]; recentNutrition?: unknown[] }
        try {
          ctx = JSON.parse(raw)
        } catch {
          continue
        }

        const hasEnoughData =
          (ctx.recentSessions?.length ?? 0) >= 3 || (ctx.recentNutrition?.length ?? 0) >= 5

        if (!hasEnoughData) continue

        const envelope = {
          messageId: randomUUID(),
          correlationId: randomUUID(),
          timestamp: new Date().toISOString(),
          version: '1.0',
          source: 'ai-service',
          type: 'plan.analysis.trigger',
          payload: {
            userId,
            triggerReason: 'daily_cron',
            userContextBundle: ctx,
          },
          metadata: { userId, traceId: randomUUID() },
        }

        channel.publish('fitmind.topic', 'plan.*', Buffer.from(JSON.stringify(envelope)), {
          persistent: true,
        })
      }
    } catch (err) {
      console.error('[PlanAdvisorCron] Error during daily run:', err)
    }
  })
}
