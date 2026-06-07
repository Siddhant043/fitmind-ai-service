import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Channel } from 'amqplib'
import type { Redis } from 'ioredis'
import { buildChatTools } from '../index.js'
import type { UserContextBundle } from '../../../context-builder/context-builder.js'

vi.mock('../../../context-builder/context-builder.js', () => ({
  buildUserContext: vi.fn(),
}))

vi.mock('../core-service-rpc.client.js', () => ({
  fetchChatData: vi.fn(),
}))

import { buildUserContext } from '../../../context-builder/context-builder.js'
import { fetchChatData } from '../core-service-rpc.client.js'

function makeBundle(): UserContextBundle {
  return {
    userId: 'u1',
    updatedAt: new Date().toISOString(),
    profile: {
      name: 'Alex',
      sex: 'male',
      ageYears: 28,
      weightKg: 80,
      heightCm: 175,
      goal: 'build_muscle',
      activityLevel: 'moderate',
      dietaryPref: null,
      tdee: 2400,
      macroTargets: null,
      subscriptionTier: 'free',
    },
    activePlan: null,
    recentSessions: [],
    todayNutrition: null,
    stats: { totalWorkouts: 0, currentStreakDays: 0 },
  }
}

function buildConfig() {
  return {
    userId: 'u1',
    redis: {} as Redis,
    channel: { publish: vi.fn() } as unknown as Channel,
  }
}

describe('buildChatTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('get_last_workout returns lastWorkoutDetail from Redis context', async () => {
    vi.mocked(buildUserContext).mockResolvedValue({
      userId: 'u1',
      updatedAt: new Date().toISOString(),
      profile: makeBundle().profile,
      activePlan: null,
      recentSessions: [],
      todayNutrition: null,
      stats: { totalWorkouts: 0, currentStreakDays: 0 },
      lastWorkoutDetail: {
        sessionId: 's1',
        date: '2026-06-05',
        durationMin: 50,
        planDayLabel: null,
        totalVolumeKg: 1000,
        exercises: [],
      },
    })

    const tools = buildChatTools(buildConfig())
    const workoutTool = tools.find((tool) => tool.name === 'get_last_workout')
    expect(workoutTool).toBeDefined()

    const output = await (workoutTool as { invoke: (input: object) => Promise<unknown> }).invoke({})
    expect(JSON.parse(String(output))).toMatchObject({ sessionId: 's1' })
  })

  it('get_last_meal returns lastMealDetail from Redis context', async () => {
    vi.mocked(buildUserContext).mockResolvedValue({
      userId: 'u1',
      updatedAt: new Date().toISOString(),
      profile: makeBundle().profile,
      activePlan: null,
      recentSessions: [],
      todayNutrition: null,
      stats: { totalWorkouts: 0, currentStreakDays: 0 },
      lastMealDetail: {
        mealId: 'm1',
        loggedAt: '2026-06-05',
        mealType: 'lunch',
        description: null,
        macros: { calories: 500, proteinG: 30, carbsG: 40, fatsG: 15 },
        mealFeedback: null,
        vsDailyTarget: null,
      },
    })

    const tools = buildChatTools(buildConfig())
    const mealTool = tools.find((tool) => tool.name === 'get_last_meal')
    const output = await (mealTool as { invoke: (input: object) => Promise<unknown> }).invoke({})
    expect(JSON.parse(String(output))).toMatchObject({ mealId: 'm1' })
  })

  it('get_exercise_history calls RPC client', async () => {
    vi.mocked(fetchChatData).mockResolvedValue({ exerciseName: 'Bench Press' })

    const tools = buildChatTools(buildConfig())
    const historyTool = tools.find((tool) => tool.name === 'get_exercise_history')
    const output = await (historyTool as { invoke: (input: object) => Promise<unknown> }).invoke({
      exerciseName: 'bench press',
      limit: 3,
    })

    expect(fetchChatData).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'u1',
      'get_exercise_history',
      { exerciseName: 'bench press', limit: 3 },
    )
    expect(JSON.parse(String(output))).toMatchObject({ exerciseName: 'Bench Press' })
  })
})
