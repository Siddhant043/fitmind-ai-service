import type {
  AllowedExercise,
  GeneratedWorkoutPlan,
  WorkoutPlanGenerationRequest,
} from './workout-plan.types.js'

function pickExercises(
  catalog: AllowedExercise[],
  muscles: string[],
  count: number,
): AllowedExercise[] {
  const picked: AllowedExercise[] = []
  const used = new Set<string>()

  for (const muscle of muscles) {
    for (const exercise of catalog) {
      if (picked.length >= count) break
      if (used.has(exercise.id)) continue
      if (exercise.muscleGroup.toLowerCase().includes(muscle.toLowerCase())) {
        picked.push(exercise)
        used.add(exercise.id)
      }
    }
  }

  for (const exercise of catalog) {
    if (picked.length >= count) break
    if (!used.has(exercise.id)) {
      picked.push(exercise)
      used.add(exercise.id)
    }
  }

  return picked.slice(0, count)
}

function buildDay(
  label: string,
  order: number,
  exercises: AllowedExercise[],
  sets: number,
  repRange: string,
) {
  return {
    dayLabel: label,
    dayOrder: order,
    daysOfWeek: [] as number[],
    exercises: exercises.map((exercise, index) => ({
      exercise_id: exercise.id,
      order: index + 1,
      sets,
      rep_range: repRange,
      rest_sec: repRange.includes('15') ? 60 : 90,
      rpe_target: 7,
    })),
    notes: null,
  }
}

function maxDaysForActivity(activityLevel: string): number {
  switch (activityLevel) {
    case 'sedentary':
    case 'light':
      return 3
    case 'moderate':
      return 4
    case 'active':
      return 5
    case 'very_active':
      return 6
    default:
      return 3
  }
}

export function buildFallbackPlans(request: WorkoutPlanGenerationRequest): GeneratedWorkoutPlan[] {
  const { profile, allowedExercises, maxPlans } = request
  const catalog = allowedExercises.slice(0, 80)
  if (catalog.length < 6) {
    throw new Error('Insufficient exercises in catalog for fallback plan generation')
  }

  const goal = profile.goal
  const maxDays = maxDaysForActivity(profile.activityLevel)
  const isCut = goal === 'cut'
  const repRange = isCut ? '12-15' : '8-12'
  const sets = isCut ? 3 : 4

  const plans: GeneratedWorkoutPlan[] = []

  const fullBodyExercises = pickExercises(
    catalog,
    ['chest', 'back', 'quadriceps', 'shoulders', 'core'],
    5,
  )
  plans.push({
    name: 'Personal Full Body Starter',
    description: `A balanced ${maxDays >= 3 ? 3 : maxDays}-day full-body programme tailored for ${goal} with compound-focused sessions.`,
    goal,
    daysPerWeek: Math.min(3, maxDays),
    tags: ['Beginner', 'Full Body', 'Compound'],
    days: [
      buildDay('Full Body A', 1, fullBodyExercises.slice(0, 5), sets, repRange),
      buildDay(
        'Full Body B',
        2,
        pickExercises(catalog, ['back', 'hamstrings', 'glutes', 'biceps'], 5),
        sets,
        repRange,
      ),
      ...(maxDays >= 3
        ? [
            buildDay(
              'Full Body C',
              3,
              pickExercises(catalog, ['chest', 'shoulders', 'core', 'calves'], 5),
              sets,
              repRange,
            ),
          ]
        : []),
    ],
  })

  if (maxPlans >= 2 && maxDays >= 4) {
    plans.push({
      name: 'Personal Upper / Lower Split',
      description: `Upper and lower body split optimised for ${goal}, alternating strength and hypertrophy emphasis.`,
      goal,
      daysPerWeek: Math.min(4, maxDays),
      tags: ['Intermediate', 'Upper/Lower', 'Strength'],
      days: [
        buildDay(
          'Upper A',
          1,
          pickExercises(catalog, ['chest', 'back', 'shoulders', 'triceps'], 5),
          sets,
          repRange,
        ),
        buildDay(
          'Lower A',
          2,
          pickExercises(catalog, ['quadriceps', 'hamstrings', 'glutes', 'calves'], 5),
          sets,
          repRange,
        ),
        buildDay(
          'Upper B',
          3,
          pickExercises(catalog, ['back', 'chest', 'biceps', 'shoulders'], 5),
          sets - 1,
          repRange,
        ),
        buildDay(
          'Lower B',
          4,
          pickExercises(catalog, ['glutes', 'quadriceps', 'hamstrings', 'core'], 5),
          sets - 1,
          repRange,
        ),
      ].slice(0, Math.min(4, maxDays)),
    })
  }

  if (maxPlans >= 3 && maxDays >= 5 && (goal === 'bulk' || goal === 'recomposition')) {
    plans.push({
      name: 'Personal Push / Pull / Legs',
      description: `High-frequency hypertrophy split for ${goal}, hitting each muscle group twice per week.`,
      goal,
      daysPerWeek: Math.min(6, maxDays),
      tags: ['Hypertrophy', 'PPL', 'Barbell'],
      days: [
        buildDay(
          'Push',
          1,
          pickExercises(catalog, ['chest', 'shoulders', 'triceps'], 5),
          sets,
          repRange,
        ),
        buildDay(
          'Pull',
          2,
          pickExercises(catalog, ['back', 'biceps', 'forearms'], 5),
          sets,
          repRange,
        ),
        buildDay(
          'Legs',
          3,
          pickExercises(catalog, ['quadriceps', 'hamstrings', 'glutes', 'calves'], 5),
          sets,
          repRange,
        ),
        buildDay(
          'Push B',
          4,
          pickExercises(catalog, ['chest', 'shoulders', 'triceps'], 5),
          sets - 1,
          repRange,
        ),
        buildDay('Pull B', 5, pickExercises(catalog, ['back', 'biceps'], 5), sets - 1, repRange),
        buildDay(
          'Legs B',
          6,
          pickExercises(catalog, ['quadriceps', 'glutes', 'hamstrings'], 5),
          sets - 1,
          repRange,
        ),
      ].slice(0, Math.min(6, maxDays)),
    })
  }

  return plans.slice(0, maxPlans)
}
