import { describe, it, expect, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { buildUserContext, formatContextForPrompt } from '../context-builder.js'
import type { UserContextBundle } from '../context-builder.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function mockRedis(value: string | null): Redis {
  return { get: vi.fn().mockResolvedValue(value) } as unknown as Redis
}

function makeBundle(overrides: Partial<UserContextBundle> = {}): UserContextBundle {
  return {
    userId: 'user-1',
    updatedAt: new Date().toISOString(),
    profile: {
      name: 'Alex',
      sex: 'male',
      ageYears: 28,
      weightKg: 80,
      heightCm: 175,
      goal: 'build_muscle',
      activityLevel: 'moderate',
      dietaryPref: 'vegetarian',
      tdee: 2400,
      macroTargets: { calories: 2400, protein_g: 180, carbs_g: 260, fats_g: 70, fiber_g: 30 },
      subscriptionTier: 'pro',
    },
    activePlan: { name: 'PPL Program', daysPerWeek: 6 },
    recentSessions: [
      {
        date: '2026-06-01',
        durationMin: 60,
        totalVolumeKg: 4500,
        muscleGroups: ['chest', 'triceps'],
      },
    ],
    todayNutrition: { calories: 1800, proteinG: 120, carbsG: 200, fatsG: 55, mealsLogged: 3 },
    stats: { totalWorkouts: 45, currentStreakDays: 7 },
    ...overrides,
  }
}

// ── buildUserContext ──────────────────────────────────────────────────────────

describe('buildUserContext', () => {
  it('returns parsed bundle on Redis cache hit', async () => {
    const bundle = makeBundle()
    const redis = mockRedis(JSON.stringify(bundle))
    const result = await buildUserContext('user-1', redis)
    expect(result).not.toBeNull()
    expect(result!.userId).toBe('user-1')
    expect(result!.profile.name).toBe('Alex')
  })

  it('calls Redis with the correct key', async () => {
    const redis = mockRedis(null)
    await buildUserContext('user-42', redis)
    expect(redis.get).toHaveBeenCalledWith('user_context:user-42')
  })

  it('returns null when key is missing from Redis', async () => {
    const redis = mockRedis(null)
    const result = await buildUserContext('user-1', redis)
    expect(result).toBeNull()
  })

  it('returns null (does not throw) when Redis value is malformed JSON', async () => {
    const redis = mockRedis('{ not valid json }}}')
    const result = await buildUserContext('user-1', redis)
    expect(result).toBeNull()
  })
})

// ── formatContextForPrompt ────────────────────────────────────────────────────

describe('formatContextForPrompt', () => {
  it('includes Goal line', () => {
    const text = formatContextForPrompt(makeBundle())
    expect(text).toContain('Goal:')
  })

  it('includes TDEE when set', () => {
    const text = formatContextForPrompt(makeBundle())
    expect(text).toContain('TDEE: 2400 kcal/day')
  })

  it('shows "TDEE: not calculated" when tdee is null', () => {
    const text = formatContextForPrompt(
      makeBundle({ profile: { ...makeBundle().profile, tdee: null } }),
    )
    expect(text).toContain('TDEE: not calculated')
  })

  it('includes Macro targets when set', () => {
    const text = formatContextForPrompt(makeBundle())
    expect(text).toContain('Macro targets:')
  })

  it('includes active plan name', () => {
    const text = formatContextForPrompt(makeBundle())
    expect(text).toContain('Active plan: "PPL Program"')
  })

  it('shows "No active plan" when activePlan is null', () => {
    const text = formatContextForPrompt(makeBundle({ activePlan: null }))
    expect(text).toContain('No active plan')
  })

  it("includes today's nutrition when present", () => {
    const text = formatContextForPrompt(makeBundle())
    expect(text).toContain("Today's nutrition:")
    expect(text).toContain('1800 kcal')
  })

  it('shows "No meals logged today" when todayNutrition is null', () => {
    const text = formatContextForPrompt(makeBundle({ todayNutrition: null }))
    expect(text).toContain('No meals logged today')
  })

  it('includes recent session muscle groups', () => {
    const text = formatContextForPrompt(makeBundle())
    expect(text).toContain('chest')
  })

  it('shows "No recent sessions" when sessions array is empty', () => {
    const text = formatContextForPrompt(makeBundle({ recentSessions: [] }))
    expect(text).toContain('No recent sessions')
  })

  it('includes workout streak', () => {
    const text = formatContextForPrompt(makeBundle())
    expect(text).toContain('7 day streak')
  })

  it('includes last workout summary when lastWorkoutDetail is present', () => {
    const text = formatContextForPrompt(
      makeBundle({
        lastWorkoutDetail: {
          sessionId: 's1',
          date: '2026-06-05',
          durationMin: 55,
          planDayLabel: 'Push',
          totalVolumeKg: 3200,
          exercises: [
            {
              exerciseId: 'ex1',
              name: 'Bench Press',
              muscleGroups: ['chest'],
              workingSets: [{ setNumber: 1, reps: 8, weightKg: 60, rpe: 8 }],
              workingVolumeKg: 480,
              performanceFlags: ['volume_down_12pct'],
              vsPrevious: { volumeDeltaPct: -12, maxWeightDeltaKg: 0 },
              vsPlan: null,
            },
          ],
        },
      }),
    )
    expect(text).toContain('Last workout')
    expect(text).toContain('Bench Press')
  })

  it('includes last meal summary when lastMealDetail is present', () => {
    const text = formatContextForPrompt(
      makeBundle({
        lastMealDetail: {
          mealId: 'm1',
          loggedAt: '2026-06-05T12:00:00.000Z',
          mealType: 'lunch',
          description: 'Paneer curry',
          macros: { calories: 620, proteinG: 28, carbsG: 45, fatsG: 22 },
          mealFeedback: 'Add more protein',
          vsDailyTarget: { proteinPct: 15, caloriesPct: 25 },
        },
      }),
    )
    expect(text).toContain('Last meal')
    expect(text).toContain('Paneer curry')
  })
})
