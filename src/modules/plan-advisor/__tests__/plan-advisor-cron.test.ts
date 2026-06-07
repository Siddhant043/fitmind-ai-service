import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Channel } from 'amqplib'
import type { Redis } from 'ioredis'

// ── Capture cron callback synchronously ───────────────────────────────────────

let capturedCronFn: (() => Promise<void>) | null = null

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_schedule: string, fn: () => Promise<void>) => {
      capturedCronFn = fn
    }),
  },
}))

import { startPlanAdvisorCron } from '../plan-advisor.cron.js'
import cron from 'node-cron'

// ── helpers ───────────────────────────────────────────────────────────────────

function buildMockChannel() {
  return {
    publish: vi.fn(),
  } as unknown as Channel & { publish: ReturnType<typeof vi.fn> }
}

function buildMockRedis(keys: string[], store: Record<string, string>) {
  return {
    keys: vi.fn().mockResolvedValue(keys),
    get: vi.fn(async (key: string) => store[key] ?? null),
  } as unknown as Redis
}

function makeCtx(recentSessions: number, recentNutrition = 0) {
  return JSON.stringify({
    recentSessions: Array.from({ length: recentSessions }, (_, i) => ({
      date: `2026-06-0${i + 1}`,
    })),
    recentNutrition: Array.from({ length: recentNutrition }, () => ({})),
  })
}

async function runCron(channel: ReturnType<typeof buildMockChannel>, redis: Redis) {
  capturedCronFn = null
  startPlanAdvisorCron(channel as unknown as Channel, redis)
  if (!capturedCronFn) throw new Error('Cron callback not captured')
  await capturedCronFn()
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  capturedCronFn = null
})

describe('startPlanAdvisorCron', () => {
  it('schedules a cron at 0 2 * * *', () => {
    const channel = buildMockChannel()
    startPlanAdvisorCron(channel as unknown as Channel, buildMockRedis([], {}))
    expect(vi.mocked(cron.schedule)).toHaveBeenCalledWith('0 2 * * *', expect.any(Function))
  })

  it('does not publish when no user_context keys in Redis', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis([], {})
    await runCron(channel, redis)
    expect(channel.publish).not.toHaveBeenCalled()
  })

  it('publishes trigger for user with ≥3 recent sessions', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis(['user_context:u1'], { 'user_context:u1': makeCtx(3) })
    await runCron(channel, redis)
    expect(channel.publish).toHaveBeenCalledOnce()
    const [exchange, routingKey, buf] = channel.publish.mock.calls[0] as [string, string, Buffer]
    expect(exchange).toBe('fitmind.topic')
    expect(routingKey).toBe('plan.*')
    const envelope = JSON.parse(buf.toString())
    expect(envelope.payload.userId).toBe('u1')
    expect(envelope.payload.triggerReason).toBe('daily_cron')
  })

  it('publishes trigger for user with ≥5 nutrition days (< 3 sessions)', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis(['user_context:u1'], { 'user_context:u1': makeCtx(0, 5) })
    await runCron(channel, redis)
    expect(channel.publish).toHaveBeenCalledOnce()
  })

  it('skips user with < 3 sessions and < 5 nutrition days', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis(['user_context:u1'], { 'user_context:u1': makeCtx(2, 4) })
    await runCron(channel, redis)
    expect(channel.publish).not.toHaveBeenCalled()
  })

  it('publishes once per qualifying user across multiple users', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis(['user_context:u1', 'user_context:u2', 'user_context:u3'], {
      'user_context:u1': makeCtx(3), // qualifies
      'user_context:u2': makeCtx(1, 2), // does not qualify
      'user_context:u3': makeCtx(0, 6), // qualifies via nutrition
    })
    await runCron(channel, redis)
    expect(channel.publish).toHaveBeenCalledTimes(2)
  })

  it('skips key with malformed JSON without throwing, processes remaining', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis(['user_context:bad', 'user_context:good'], {
      'user_context:bad': '{ not valid json }}}',
      'user_context:good': makeCtx(4),
    })
    await runCron(channel, redis)
    expect(channel.publish).toHaveBeenCalledOnce()
    const envelope = JSON.parse((channel.publish.mock.calls[0][2] as Buffer).toString())
    expect(envelope.payload.userId).toBe('good')
  })

  it('skips key when Redis returns null for that key', async () => {
    const channel = buildMockChannel()
    const redis = buildMockRedis(['user_context:u1'], {})
    await runCron(channel, redis)
    expect(channel.publish).not.toHaveBeenCalled()
  })
})
