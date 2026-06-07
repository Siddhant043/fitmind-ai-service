import { describe, it, expect } from 'vitest'
import { parseMealAnalyzerOutput } from '../meal-analyzer.normalize.js'

describe('parseMealAnalyzerOutput', () => {
  it('accepts a well-formed response', () => {
    const parsed = parseMealAnalyzerOutput({
      foods_detected: [
        {
          name: 'Roti',
          quantity: '2 pieces',
          calories: 160,
          proteinG: 6,
          carbsG: 30,
          fatsG: 1,
          fiberG: 2,
        },
      ],
      macros: {
        calories: 160,
        proteinG: 6,
        carbsG: 30,
        fatsG: 1,
        fiberG: 2,
      },
      confidence: 0.8,
      notes: 'Looks good.',
      mealFeedback: 'Good carb source for recovery.',
    })

    expect(parsed?.macros.calories).toBe(160)
    expect(parsed?.mealFeedback).toBe('Good carb source for recovery.')
  })

  it('repairs Ollama responses where the payload is embedded in foods_detected string', () => {
    const malformed = {
      foods_detected:
        '[{"name":"Roti","quantity":"2 pieces","calories":160,"proteinG":6,"carbsG":30,"fatsG":1,"fiberG":2}], "macros": {"calories": 630, "proteinG": 36, "carbsG": 44, "fatsG": 38, "fiberG": 4}, "confidence": 0.85, "notes": "Balanced meal."',
    }

    const parsed = parseMealAnalyzerOutput(malformed)
    expect(parsed?.macros.calories).toBe(630)
    expect(parsed?.foods_detected).toHaveLength(1)
    expect(parsed?.notes).toContain('Balanced meal')
  })

  it('derives macros from foods when totals are missing', () => {
    const parsed = parseMealAnalyzerOutput({
      foods_detected: [
        {
          name: 'Roti',
          quantity: '2 pieces',
          calories: 160,
          proteinG: 6,
          carbsG: 30,
          fatsG: 1,
          fiberG: 2,
        },
        {
          name: 'Dal',
          quantity: '1 bowl',
          calories: 150,
          proteinG: 8,
          carbsG: 22,
          fatsG: 4,
          fiberG: 6,
        },
      ],
      confidence: 0.7,
      notes: 'Estimated from items.',
      mealFeedback: 'Balanced macros across items.',
    })

    expect(parsed?.macros).toEqual({
      calories: 310,
      proteinG: 14,
      carbsG: 52,
      fatsG: 5,
      fiberG: 8,
    })
  })
})
