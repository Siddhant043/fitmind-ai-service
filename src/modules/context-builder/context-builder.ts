import type { Redis } from 'ioredis'

export interface MacroTargets {
  calories: number
  protein_g: number
  carbs_g: number
  fats_g: number
  fiber_g: number
}

export interface UserContextBundle {
  userId: string
  updatedAt: string
  profile: {
    name: string | null
    sex: string | null
    ageYears: number | null
    weightKg: number | null
    heightCm: number | null
    goal: string | null
    activityLevel: string | null
    dietaryPref: string | null
    tdee: number | null
    macroTargets: MacroTargets | null
    subscriptionTier: 'free' | 'pro'
  }
  activePlan: {
    name: string
    daysPerWeek: number
  } | null
  recentSessions: Array<{
    date: string
    durationMin: number | null
    totalVolumeKg: number | null
    muscleGroups: string[]
  }>
  todayNutrition: {
    calories: number
    proteinG: number
    carbsG: number
    fatsG: number
    mealsLogged: number
  } | null
  stats: {
    totalWorkouts: number
    currentStreakDays: number
  }
}

export async function buildUserContext(
  userId: string,
  redis: Redis,
): Promise<UserContextBundle | null> {
  const raw = await redis.get(`user_context:${userId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UserContextBundle
  } catch {
    return null
  }
}

export function formatContextForPrompt(ctx: UserContextBundle): string {
  const p = ctx.profile
  const lines: string[] = [
    `User: ${p.name ?? 'Unknown'}, ${p.ageYears ? p.ageYears + 'yo' : ''} ${p.sex ?? ''}, ${p.weightKg ? p.weightKg + 'kg' : ''} ${p.heightCm ? p.heightCm + 'cm' : ''}`.trim(),
    `Goal: ${p.goal ?? 'not set'} | Activity: ${p.activityLevel ?? 'unknown'} | Diet: ${p.dietaryPref ?? 'no restriction'}`,
    p.tdee ? `TDEE: ${p.tdee} kcal/day` : 'TDEE: not calculated',
    p.macroTargets
      ? `Macro targets: ${p.macroTargets.calories} kcal, P${p.macroTargets.protein_g}g C${p.macroTargets.carbs_g}g F${p.macroTargets.fats_g}g`
      : '',
    ctx.activePlan
      ? `Active plan: "${ctx.activePlan.name}" (${ctx.activePlan.daysPerWeek} days/week)`
      : 'No active plan',
    ctx.stats.totalWorkouts > 0
      ? `Workouts: ${ctx.stats.totalWorkouts} total, ${ctx.stats.currentStreakDays} day streak`
      : 'No workouts logged yet',
    ctx.recentSessions.length > 0
      ? `Recent sessions: ${ctx.recentSessions
          .slice(0, 3)
          .map((s) => `${s.date} (${s.muscleGroups.join(', ') || 'n/a'})`)
          .join('; ')}`
      : 'No recent sessions',
    ctx.todayNutrition
      ? `Today's nutrition: ${ctx.todayNutrition.calories} kcal, P${ctx.todayNutrition.proteinG}g (${ctx.todayNutrition.mealsLogged} meals logged)`
      : 'No meals logged today',
  ]

  return lines.filter(Boolean).join('\n')
}
