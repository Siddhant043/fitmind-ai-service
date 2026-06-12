import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { buildPrimaryModel } from '../../providers/llm-provider.factory.js'
import { resolveStructuredOutputMethod } from '../../providers/llm-provider.factory.js'
import { formatContextForPrompt } from '../context-builder/context-builder.js'
import type { UserContextBundle } from '../context-builder/context-builder.js'
import {
  challengeSuggestionOutputSchema,
  type ChallengeSuggestionOutput,
  type ChallengeSuggestionRequest,
} from './challenge-suggester.types.js'

const SYSTEM_PROMPT = `You create bespoke 7-day fitness micro-challenges for FitMind users.
Output JSON only via the structured schema. Criteria must use ONLY these rule types:
workout_count, protein_hit_rate, nutrition_log_rate, pr_count, muscle_group_session_count, post_workout_meal_within.
Keep challenges achievable, specific, and aligned with the user's goal. Never shame failure.`

function buildFallback(_request: ChallengeSuggestionRequest): ChallengeSuggestionOutput {
  return {
    title: 'Consistency Sprint',
    description: 'Log meals on 5 of 7 days and complete 2 workouts this week.',
    durationDays: 7,
    criteriaJson: {
      operator: 'AND',
      rules: [
        { type: 'nutrition_log_rate', window_days: 7, min_pct: 0.71 },
        { type: 'workout_count', window_days: 7, min: 2 },
      ],
    },
  }
}

export async function generateChallengeSuggestion(
  request: ChallengeSuggestionRequest,
  userContext: UserContextBundle | null,
): Promise<ChallengeSuggestionOutput> {
  const contextSummary = userContext ? formatContextForPrompt(userContext) : 'No user context.'

  try {
    const model = buildPrimaryModel('fast')
    const structured = model.withStructuredOutput(challengeSuggestionOutputSchema, {
      name: 'challenge_suggestion',
      method: resolveStructuredOutputMethod(),
    })

    const result = await structured.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(
        `Create one opt-in 7-day challenge for this user.\nTrigger: ${request.triggerReason}\n\n${contextSummary}`,
      ),
    ])

    const parsed = challengeSuggestionOutputSchema.safeParse(result)
    if (!parsed.success) return buildFallback(request)
    return parsed.data
  } catch {
    return buildFallback(request)
  }
}
