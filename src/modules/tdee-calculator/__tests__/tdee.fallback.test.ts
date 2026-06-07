import { describe, it, expect } from 'vitest'
import { calculateTdeeFallback } from '../tdee.fallback.js'

describe('calculateTdeeFallback', () => {
  it('returns positive macro targets for a typical user', () => {
    const result = calculateTdeeFallback({
      sex: 'male',
      weightKg: 83,
      heightCm: 169,
      ageYears: 24,
      activityLevel: 'moderate',
      goal: 'cut',
    })

    expect(result.calories).toBeGreaterThan(1200)
    expect(result.protein_g).toBeGreaterThan(0)
    expect(result.carbs_g).toBeGreaterThan(0)
    expect(result.fats_g).toBeGreaterThan(0)
    expect(result.reasoning.length).toBeGreaterThan(10)
  })
})
