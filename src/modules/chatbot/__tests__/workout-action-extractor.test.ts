import { vi, describe, it, expect, beforeEach } from 'vitest'
import { extractWorkoutPlanAction, extractWorkoutDayAction } from '../workout-action-extractor.js'

const PPL_RESPONSE = `
Here's your 6-day PPL program:

**Day 1 — Push**
- Bench Press: 4 sets × 6-8 reps
- Overhead Press: 3 sets × 8-10 reps
- Incline Dumbbell Press: 3 sets × 10-12 reps

**Day 2 — Pull**
- Barbell Row: 4 sets × 6-8 reps
- Lat Pulldown: 3 sets × 10-12 reps

**Day 3 — Legs**
- Squat: 4 sets × 6-8 reps
- Romanian Deadlift: 3 sets × 8-10 reps
`

const PUSH_DAY_RESPONSE = `
**Push Day**

1. Bench Press — 4 sets × 6-8 reps, 90s rest
2. Overhead Press — 3 sets × 8-10 reps
3. Cable Fly — 3 sets × 12-15 reps
4. Tricep Pushdown — 3 sets × 12-15 reps
`

const GENERAL_RESPONSE =
  'Stay consistent with progressive overload and eat enough protein — around 1.6-2.2g per kg bodyweight.'

function buildMockModel(extractionResult: unknown) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue(extractionResult),
    }),
  }
}

describe('extractWorkoutPlanAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns structured plan payload when LLM finds a plan', async () => {
    const model = buildMockModel({
      isPlanPresent: true,
      name: '6-Day PPL Program',
      goal: 'bulk',
      difficulty: 'intermediate',
      daysPerWeek: 6,
      description: null,
      days: [
        {
          dayLabel: 'Push',
          exercises: [{ name: 'Bench Press', sets: 4, repRange: '6-8', restSec: 90 }],
        },
        {
          dayLabel: 'Pull',
          exercises: [{ name: 'Barbell Row', sets: 4, repRange: '6-8', restSec: null }],
        },
      ],
    })

    const result = await extractWorkoutPlanAction(PPL_RESPONSE, model)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('workout_plan_create')
    if (result?.type === 'workout_plan_create') {
      expect(result.data.name).toBe('6-Day PPL Program')
      expect(result.data.days).toHaveLength(2)
      expect(result.data.daysPerWeek).toBe(6)
    }
  })

  it('returns null when LLM signals no plan present', async () => {
    const model = buildMockModel({ isPlanPresent: false })
    const result = await extractWorkoutPlanAction(GENERAL_RESPONSE, model)
    expect(result).toBeNull()
  })
})

describe('extractWorkoutDayAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns structured day payload when LLM finds a workout day', async () => {
    const model = buildMockModel({
      isDayPresent: true,
      dayLabel: 'Push Day',
      exercises: [
        { name: 'Bench Press', sets: 4, repRange: '6-8', restSec: 90 },
        { name: 'Overhead Press', sets: 3, repRange: '8-10', restSec: null },
      ],
    })

    const result = await extractWorkoutDayAction(PUSH_DAY_RESPONSE, model)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('workout_day_create')
    if (result?.type === 'workout_day_create') {
      expect(result.data.dayLabel).toBe('Push Day')
      expect(result.data.exercises).toHaveLength(2)
    }
  })

  it('returns null for general fitness advice', async () => {
    const model = buildMockModel({ isDayPresent: false })
    const result = await extractWorkoutDayAction(GENERAL_RESPONSE, model)
    expect(result).toBeNull()
  })
})
