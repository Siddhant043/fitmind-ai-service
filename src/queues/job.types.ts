export interface MealAnalysisWorkoutSuggestion {
  exerciseName: string
  durationMinutes: number
  estimatedCalsBurned: number
  rationale: string
}

export interface MealAnalysisResult {
  mealId: string
  userId: string
  status: 'completed' | 'failed'
  confidence: number | null
  macros: {
    calories: number
    proteinG: number
    carbsG: number
    fatsG: number
    fiberG: number
  } | null
  mealFeedback: string | null
  workoutSuggestion: MealAnalysisWorkoutSuggestion | null
  aiRawResponse: Record<string, unknown> | null
  errorMessage: string | null
}

export type ChatDataToolName = 'get_exercise_history' | 'get_workout_session'

export interface ChatDataRequest {
  userId: string
  tool: ChatDataToolName
  args: {
    exerciseName?: string
    sessionId?: string
    limit?: number
  }
}

export interface ChatDataResult {
  correlationId: string
  status: 'completed' | 'failed'
  result: unknown | null
  errorMessage: string | null
}
