import type { TdeeOutput } from './tdee.prompt.js'

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export function calculateTdeeFallback(input: {
  sex: string
  weightKg: number
  heightCm: number
  ageYears: number
  activityLevel: string
  goal: string
}): TdeeOutput {
  const bmrOffset = input.sex === 'male' ? 5 : -161
  const bmr = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears + bmrOffset

  const multiplier = ACTIVITY_MULTIPLIERS[input.activityLevel] ?? 1.55
  let calories = Math.round(bmr * multiplier)

  switch (input.goal) {
    case 'cut':
      calories = Math.round(calories * 0.8)
      break
    case 'bulk':
      calories = Math.round(calories * 1.1)
      break
    case 'recomposition':
      calories = Math.round(calories * 0.95)
      break
    default:
      break
  }

  const proteinG = Math.round(input.weightKg * 2.0)
  const fatsG = Math.round((calories * 0.27) / 9)
  const carbsG = Math.max(Math.round((calories - proteinG * 4 - fatsG * 9) / 4), 50)

  return {
    calories,
    protein_g: proteinG,
    carbs_g: carbsG,
    fats_g: fatsG,
    fiber_g: 30,
    reasoning:
      'Calculated with the Mifflin-St Jeor equation and standard macro split (AI unavailable).',
  }
}
