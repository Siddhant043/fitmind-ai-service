import { z } from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { resolveStructuredOutputMethod } from '../../providers/llm-provider.factory.js'
import type { ChallengeSuggestAction } from '../challenge-suggester/challenge-suggester.types.js'

const challengeExtractionSchema = z.object({
  isChallengePresent: z.boolean(),
  title: z.string().optional(),
  description: z.string().optional(),
  templateKey: z.string().optional().nullable(),
  requestCoachGeneration: z.boolean().optional(),
})

type StructuredExtractionModel = {
  withStructuredOutput: (
    schema: z.ZodTypeAny,
    config?: {
      name?: string
      method?: 'functionCalling' | 'jsonMode' | 'jsonSchema'
    },
  ) => { invoke: (messages: unknown[]) => Promise<unknown> }
}

const CHALLENGE_EXTRACTION_PROMPT = `You extract a structured 7-day fitness micro-challenge from an AI coach response.
Set isChallengePresent to true only when the coach proposes a specific opt-in challenge contract the user can accept.
If the response is general advice without a concrete challenge, set isChallengePresent to false.
Prefer known template keys when applicable: protein_6_of_7, extra_leg_session, post_workout_meal_1h, log_streak_7, three_workouts_week.
If bespoke, leave templateKey null and set requestCoachGeneration true.`

export async function extractChallengeAction(
  responseText: string,
  model: StructuredExtractionModel,
): Promise<ChallengeSuggestAction | null> {
  const structured = model.withStructuredOutput(challengeExtractionSchema, {
    name: 'challenge_extraction',
    method: resolveStructuredOutputMethod(),
  })

  const result = await structured.invoke([
    new SystemMessage(CHALLENGE_EXTRACTION_PROMPT),
    new HumanMessage(responseText),
  ])

  const parsed = challengeExtractionSchema.safeParse(result)
  if (!parsed.success || !parsed.data.isChallengePresent) return null

  const { title, description, templateKey, requestCoachGeneration } = parsed.data
  if (!title || !description) return null

  return {
    type: 'challenge_suggest',
    data: {
      title,
      description,
      templateKey: templateKey ?? null,
      requestCoachGeneration: requestCoachGeneration ?? templateKey == null,
    },
  }
}
