import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Channel, ConsumeMessage } from 'amqplib'
import type { Redis } from 'ioredis'

// ─── Mock LangGraph graph ─────────────────────────────────────────────────────

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))

vi.mock('../../../modules/rag/rag.retriever.js', () => ({
  retrieveWithRerank: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../providers/llm-provider.factory.js', () => ({
  buildPrimaryModel: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue({ content: '{}' }),
    stream: vi.fn(),
  }),
  buildFallbackModel: vi.fn().mockReturnValue(null),
}))

vi.mock('../plan-advisor.graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plan-advisor.graph.js')>()
  return {
    ...actual,
    planAdvisorGraph: { invoke: async (...args: unknown[]) => mockInvoke(...args) },
  }
})

import {
  computeDeltas,
  classifyIssue,
  PROTEIN_DEFICIT_MIN_DAYS,
  MISSED_WORKOUT_STREAK,
} from '../plan-advisor.graph.js'
import { startPlanAdvisorWorker } from '../plan-advisor.worker.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

function buildMockChannel() {
  return {
    prefetch: vi.fn(),
    consume: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn(),
  }
}

function buildMockRedis() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
  } as unknown as Redis
}

function makeMsg(payload: object, correlationId = 'corr-1', retryCount = 0): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify({ correlationId, payload })),
    properties: { headers: retryCount > 0 ? { 'x-retry-count': retryCount } : {} },
  } as unknown as ConsumeMessage
}

function buildContext(
  overrides: Partial<{
    proteinG: number
    targetProtein: number
    calories: number
    targetCalories: number
    tdee: number
    sessionDaysAgo: number[]
  }> = {},
) {
  const {
    proteinG = 100,
    targetProtein = 150,
    calories = 2000,
    targetCalories = 2000,
    tdee = 2000,
    sessionDaysAgo = [0, 1, 2],
  } = overrides

  const today = new Date()
  const sessions = sessionDaysAgo.map((d) => {
    const date = new Date(today)
    date.setDate(date.getDate() - d)
    return {
      date: date.toISOString().slice(0, 10),
      durationMin: 60,
      totalVolumeKg: 3000,
      muscleGroups: ['chest'],
    }
  })

  const nutrition = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    return { date: date.toISOString().slice(0, 10), calories, proteinG, carbsG: 200, fatsG: 60 }
  })

  return {
    userId: 'user-1',
    updatedAt: today.toISOString(),
    profile: {
      name: 'Test',
      sex: 'male',
      ageYears: 28,
      weightKg: 80,
      heightCm: 178,
      goal: 'bulk',
      activityLevel: 'moderate',
      dietaryPref: null,
      tdee,
      macroTargets: {
        calories: targetCalories,
        protein_g: targetProtein,
        carbs_g: 250,
        fats_g: 65,
        fiber_g: 30,
      },
      subscriptionTier: 'pro' as const,
    },
    activePlan: { name: 'PPL', daysPerWeek: 5 },
    recentSessions: sessions,
    recentNutrition: nutrition,
    todayNutrition: { calories, proteinG, carbsG: 200, fatsG: 60, mealsLogged: 3 },
    stats: { totalWorkouts: 50, currentStreakDays: 3 },
  }
}

// ─── Unit tests: delta computations ──────────────────────────────────────────

describe('computeDeltas', () => {
  it('detects protein deficit when avg protein is below 85% of target for 5+ days', () => {
    const ctx = buildContext({ proteinG: 100, targetProtein: 150 }) // 67% of target
    const deltas = computeDeltas(ctx)
    expect(deltas.proteinDeficitDays).toBeGreaterThanOrEqual(PROTEIN_DEFICIT_MIN_DAYS)
    expect(deltas.avgProteinPct).toBeLessThan(0.85)
  })

  it('does not flag protein deficit when protein is at or above 85% of target', () => {
    const ctx = buildContext({ proteinG: 135, targetProtein: 150 }) // 90% of target
    const deltas = computeDeltas(ctx)
    expect(deltas.avgProteinPct).toBeGreaterThanOrEqual(0.85)
  })

  it('detects missed workout streak when no sessions in recent days', () => {
    const today = new Date()
    const fourDaysAgo = new Date(today)
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4)
    const ctx = buildContext({ sessionDaysAgo: [4, 5, 6] }) // last session was 4 days ago
    const deltas = computeDeltas(ctx)
    expect(deltas.missedWorkoutStreak).toBeGreaterThanOrEqual(MISSED_WORKOUT_STREAK)
  })

  it('returns zero missed streak when session was today', () => {
    const ctx = buildContext({ sessionDaysAgo: [0, 2, 4] })
    const deltas = computeDeltas(ctx)
    expect(deltas.missedWorkoutStreak).toBe(0)
  })
})

describe('classifyIssue', () => {
  it('returns nutrition when protein deficit days >= threshold', () => {
    const result = classifyIssue({
      proteinDeficitDays: 5,
      avgProteinPct: 0.7,
      missedWorkoutStreak: 0,
      avgCaloriePct: 1.0,
      sessionsLast7Days: 3,
      volumeDeclinePct: 0,
    })
    expect(result).toBe('nutrition')
  })

  it('returns workout when missed workout streak >= threshold', () => {
    const result = classifyIssue({
      proteinDeficitDays: 0,
      avgProteinPct: 0.9,
      missedWorkoutStreak: 3,
      avgCaloriePct: 1.0,
      sessionsLast7Days: 0,
      volumeDeclinePct: 0,
    })
    expect(result).toBe('workout')
  })

  it('returns goal when calorie surplus and low training frequency', () => {
    const result = classifyIssue({
      proteinDeficitDays: 0,
      avgProteinPct: 0.9,
      missedWorkoutStreak: 0,
      avgCaloriePct: 1.15,
      sessionsLast7Days: 1,
      volumeDeclinePct: 0,
    })
    expect(result).toBe('goal')
  })

  it('returns recovery when volume declines by >= 20%', () => {
    const result = classifyIssue({
      proteinDeficitDays: 0,
      avgProteinPct: 0.9,
      missedWorkoutStreak: 0,
      avgCaloriePct: 1.0,
      sessionsLast7Days: 3,
      volumeDeclinePct: 0.25,
    })
    expect(result).toBe('recovery')
  })

  it('returns null when no threshold is breached', () => {
    const result = classifyIssue({
      proteinDeficitDays: 0,
      avgProteinPct: 0.9,
      missedWorkoutStreak: 0,
      avgCaloriePct: 1.0,
      sessionsLast7Days: 4,
      volumeDeclinePct: 0.05,
    })
    expect(result).toBeNull()
  })
})

// ─── Worker tests ─────────────────────────────────────────────────────────────

describe('startPlanAdvisorWorker', () => {
  let mockChannel: ReturnType<typeof buildMockChannel>
  let mockRedis: Redis

  beforeEach(() => {
    vi.clearAllMocks()
    mockChannel = buildMockChannel()
    mockRedis = buildMockRedis()
  })

  it('acks message after successful graph invocation', async () => {
    mockInvoke.mockResolvedValueOnce({})

    startPlanAdvisorWorker(mockChannel as unknown as Channel, mockRedis)

    const callback = mockChannel.consume.mock.calls[0][1]
    await callback(makeMsg({ userId: 'u1', triggerReason: 'daily_cron', userContextBundle: null }))

    expect(mockInvoke).toHaveBeenCalledOnce()
    expect(mockChannel.ack).toHaveBeenCalledOnce()
    expect(mockChannel.nack).not.toHaveBeenCalled()
  })

  it('nacks without requeue on transient error (retry < 3)', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('LLM timeout'))

    startPlanAdvisorWorker(mockChannel as unknown as Channel, mockRedis)

    const callback = mockChannel.consume.mock.calls[0][1]
    await callback(
      makeMsg({ userId: 'u1', triggerReason: 'daily_cron', userContextBundle: null }, 'corr-1', 1),
    )

    expect(mockChannel.nack).toHaveBeenCalledWith(expect.anything(), false, false)
    expect(mockChannel.ack).not.toHaveBeenCalled()
    expect(mockChannel.publish).not.toHaveBeenCalled()
  })

  it('publishes failure result and nacks after 3 retries exhausted', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('All retries failed'))

    startPlanAdvisorWorker(mockChannel as unknown as Channel, mockRedis)

    const callback = mockChannel.consume.mock.calls[0][1]
    await callback(
      makeMsg({ userId: 'u1', triggerReason: 'daily_cron', userContextBundle: null }, 'corr-1', 3),
    )

    expect(mockChannel.publish).toHaveBeenCalledOnce()
    const published = JSON.parse(mockChannel.publish.mock.calls[0][2].toString())
    expect(published.payload.status).toBe('failed')
    expect(published.payload.userId).toBe('u1')

    expect(mockChannel.nack).toHaveBeenCalledWith(expect.anything(), false, false)
  })

  it('nacks on malformed JSON without invoking graph', async () => {
    startPlanAdvisorWorker(mockChannel as unknown as Channel, mockRedis)

    const callback = mockChannel.consume.mock.calls[0][1]
    const badMsg = {
      content: Buffer.from('not-json'),
      properties: { headers: {} },
    } as unknown as ConsumeMessage
    await callback(badMsg)

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false)
  })
})
