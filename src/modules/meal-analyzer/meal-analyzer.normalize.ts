import { mealAnalyzerOutputSchema, type MealAnalyzerOutput } from './meal-analyzer.prompt.js'

type MacroBlock = MealAnalyzerOutput['macros']
type FoodItem = MealAnalyzerOutput['foods_detected'][number]

function toNonNegativeInt(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed)
}

function toMacroBlock(value: unknown): MacroBlock | null {
  if (value == null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const calories = toNonNegativeInt(record.calories)
  const proteinG = toNonNegativeInt(record.proteinG ?? record.protein_g)
  const carbsG = toNonNegativeInt(record.carbsG ?? record.carbs_g)
  const fatsG = toNonNegativeInt(record.fatsG ?? record.fats_g)
  const fiberG = toNonNegativeInt(record.fiberG ?? record.fiber_g ?? 0)
  if (calories == null || proteinG == null || carbsG == null || fatsG == null || fiberG == null) {
    return null
  }
  return { calories, proteinG, carbsG, fatsG, fiberG }
}

function toFoodItem(value: unknown): FoodItem | null {
  if (value == null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name : null
  const quantity = typeof record.quantity === 'string' ? record.quantity : '1 serving'
  const calories = toNonNegativeInt(record.calories)
  const proteinG = toNonNegativeInt(record.proteinG ?? record.protein_g)
  const carbsG = toNonNegativeInt(record.carbsG ?? record.carbs_g)
  const fatsG = toNonNegativeInt(record.fatsG ?? record.fats_g)
  const fiberG = toNonNegativeInt(record.fiberG ?? record.fiber_g ?? 0)
  if (
    !name ||
    calories == null ||
    proteinG == null ||
    carbsG == null ||
    fatsG == null ||
    fiberG == null
  ) {
    return null
  }
  return { name, quantity, calories, proteinG, carbsG, fatsG, fiberG }
}

function sumFoodMacros(foods: FoodItem[]): MacroBlock {
  return foods.reduce(
    (totals, food) => ({
      calories: totals.calories + food.calories,
      proteinG: totals.proteinG + food.proteinG,
      carbsG: totals.carbsG + food.carbsG,
      fatsG: totals.fatsG + food.fatsG,
      fiberG: totals.fiberG + food.fiberG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatsG: 0, fiberG: 0 },
  )
}

function parseEmbeddedFoodsDetectedString(value: string): unknown | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[')) return null

  const arrayEnd = trimmed.indexOf('],')
  if (arrayEnd === -1) return null

  try {
    const foods = JSON.parse(trimmed.slice(0, arrayEnd + 1)) as unknown
    const remainder = trimmed.slice(arrayEnd + 2).replace(/\}\s*$/, '')
    const rest = JSON.parse(`{ ${remainder} }`) as Record<string, unknown>
    return { foods_detected: foods, ...rest }
  } catch {
    return null
  }
}

function unwrapRawOutput(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return parseEmbeddedFoodsDetectedString(raw) ?? raw
    }
  }

  if (raw != null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (typeof record.foods_detected === 'string') {
      const repaired = parseEmbeddedFoodsDetectedString(record.foods_detected)
      if (repaired) return repaired
    }
  }

  return raw
}

function buildCandidate(raw: unknown): MealAnalyzerOutput | null {
  if (raw == null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>

  const foodsRaw = Array.isArray(record.foods_detected) ? record.foods_detected : []
  const foods = foodsRaw
    .map((item) => toFoodItem(item))
    .filter((item): item is FoodItem => item != null)

  const macros = toMacroBlock(record.macros) ?? (foods.length > 0 ? sumFoodMacros(foods) : null)
  const confidenceRaw = record.confidence
  const confidence =
    typeof confidenceRaw === 'number'
      ? confidenceRaw
      : typeof confidenceRaw === 'string'
        ? Number(confidenceRaw)
        : null
  const notes = typeof record.notes === 'string' ? record.notes : null
  const explicitMealFeedback =
    typeof record.mealFeedback === 'string'
      ? record.mealFeedback
      : typeof record.meal_feedback === 'string'
        ? record.meal_feedback
        : null
  const mealFeedback = explicitMealFeedback ?? notes

  let workoutSuggestion: MealAnalyzerOutput['workoutSuggestion'] = null
  const workoutRaw = record.workoutSuggestion ?? record.workout_suggestion
  if (workoutRaw != null && typeof workoutRaw === 'object') {
    const workout = workoutRaw as Record<string, unknown>
    const exerciseName = typeof workout.exerciseName === 'string' ? workout.exerciseName : null
    const durationMinutes = toNonNegativeInt(workout.durationMinutes)
    const estimatedCalsBurned = toNonNegativeInt(workout.estimatedCalsBurned)
    const rationale = typeof workout.rationale === 'string' ? workout.rationale : null
    if (
      exerciseName &&
      durationMinutes != null &&
      durationMinutes > 0 &&
      estimatedCalsBurned != null &&
      rationale
    ) {
      workoutSuggestion = { exerciseName, durationMinutes, estimatedCalsBurned, rationale }
    }
  }

  if (!macros || confidence == null || !Number.isFinite(confidence) || !notes || !mealFeedback)
    return null

  return {
    foods_detected: foods,
    macros,
    confidence: Math.min(1, Math.max(0, confidence)),
    notes,
    mealFeedback,
    workoutSuggestion,
  }
}

export function parseMealAnalyzerOutput(raw: unknown): MealAnalyzerOutput | null {
  const unwrapped = unwrapRawOutput(raw)
  const candidate = buildCandidate(unwrapped)
  if (!candidate) return null

  const validated = mealAnalyzerOutputSchema.safeParse(candidate)
  return validated.success ? validated.data : null
}
