import { describe, it, expect } from 'vitest'
import {
  challengeCriteriaSchema,
  challengeSuggestionOutputSchema,
} from '../challenge-suggester.types.js'

describe('challengeSuggestionOutputSchema', () => {
  it('accepts valid evaluable criteria', () => {
    const parsed = challengeSuggestionOutputSchema.safeParse({
      title: 'Protein Pro',
      description: 'Hit protein 6 of 7 days this week.',
      durationDays: 7,
      criteriaJson: {
        operator: 'AND',
        rules: [{ type: 'protein_hit_rate', window_days: 7, min_pct: 0.86 }],
      },
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects unknown rule types', () => {
    const parsed = challengeCriteriaSchema.safeParse({
      operator: 'AND',
      rules: [{ type: 'unknown_rule', window_days: 7, min: 1 }],
    })

    expect(parsed.success).toBe(false)
  })
})
