import type { Redis } from 'ioredis'

export interface MacroTargets {
  calories: number
  protein_g: number
  carbs_g: number
  fats_g: number
  fiber_g: number
}

export interface WorkingSetSnapshot {
  setNumber: number
  reps: number
  weightKg: number
  rpe: number | null
}

export interface WorkoutExerciseDetail {
  exerciseId: string
  name: string
  muscleGroups: string[]
  workingSets: WorkingSetSnapshot[]
  workingVolumeKg: number
  performanceFlags: string[]
  vsPrevious: { volumeDeltaPct: number; maxWeightDeltaKg: number } | null
  vsPlan: { plannedSets: number; plannedRepRange: string; hitTarget: boolean } | null
}

export interface LastWorkoutDetail {
  sessionId: string
  date: string
  durationMin: number | null
  planDayLabel: string | null
  totalVolumeKg: number | null
  exercises: WorkoutExerciseDetail[]
}

export interface MealDetailSnapshot {
  mealId: string
  loggedAt: string
  mealType: string
  description: string | null
  macros: { calories: number; proteinG: number; carbsG: number; fatsG: number }
  mealFeedback: string | null
  vsDailyTarget: { proteinPct: number; caloriesPct: number } | null
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
  recentNutrition?: Array<{
    date: string
    calories: number
    proteinG: number
    carbsG: number
    fatsG: number
  }>
  stats: {
    totalWorkouts: number
    currentStreakDays: number
  }
  gamification?: {
    recentMilestones: Array<{
      type: string
      title: string
      body: string | null
      earnedAt: string
    }>
    journey?: {
      arcName: string
      chapterTitle: string
      chapterIndex: number
      chapterCount: number
      progressPct: number
    } | null
    activeChallenge?: {
      id: string
      title: string
      description: string
      endsAt: string
      progressPct: number
    } | null
  }
  lastWorkoutDetail?: LastWorkoutDetail | null
  lastMealDetail?: MealDetailSnapshot | null
  recentMeals?: MealDetailSnapshot[]
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

  if (ctx.lastWorkoutDetail) {
    const workout = ctx.lastWorkoutDetail
    const exerciseSummary = workout.exercises
      .slice(0, 5)
      .map((exercise) => {
        const flags =
          exercise.performanceFlags.length > 0 ? ` [${exercise.performanceFlags.join(', ')}]` : ''
        return `${exercise.name}: ${exercise.workingSets.length} working sets, ${exercise.workingVolumeKg}kg volume${flags}`
      })
      .join('; ')
    lines.push(
      `Last workout (${workout.date}${workout.planDayLabel ? `, ${workout.planDayLabel}` : ''}): ${exerciseSummary || 'no exercises logged'}`,
    )
  }

  if (ctx.lastMealDetail) {
    const meal = ctx.lastMealDetail
    lines.push(
      `Last meal (${meal.mealType}, ${meal.loggedAt.slice(0, 10)}): ${meal.macros.calories} kcal, P${meal.macros.proteinG}g${meal.description ? ` — ${meal.description}` : ''}`,
    )
  }

  const milestones = ctx.gamification?.recentMilestones ?? []
  if (milestones.length > 0) {
    const achievements = milestones
      .map((m) => `${m.title}${m.body ? ` — ${m.body}` : ''} (${m.earnedAt.slice(0, 10)})`)
      .join('; ')
    lines.push(
      `Recent achievements: ${achievements}. Acknowledge briefly and naturally only if relevant — don't force it.`,
    )
  }

  const journey = ctx.gamification?.journey
  if (journey) {
    lines.push(
      `Journey: Chapter ${journey.chapterIndex + 1}/${journey.chapterCount} — ${journey.chapterTitle} (${journey.progressPct}% complete) in arc "${journey.arcName}".`,
    )
  }

  const activeChallenge = ctx.gamification?.activeChallenge
  if (activeChallenge) {
    lines.push(
      `Active challenge: "${activeChallenge.title}" (${activeChallenge.progressPct}% complete, ends ${activeChallenge.endsAt.slice(0, 10)}).`,
    )
  }

  return lines.filter(Boolean).join('\n')
}
