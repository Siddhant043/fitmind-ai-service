import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { buildPrimaryModel } from '../../providers/llm-provider.factory.js'
import type { WeeklyRecapStats } from './weekly-recap.types.js'
import {
  buildWeeklyRecapFallback,
  buildWeeklyRecapSystemPrompt,
  buildWeeklyRecapUserPrompt,
} from './weekly-recap.prompt.js'

export async function generateWeeklyRecapNarrative(stats: WeeklyRecapStats): Promise<string> {
  try {
    const model = buildPrimaryModel('fast')
    const response = await model.invoke([
      new SystemMessage(buildWeeklyRecapSystemPrompt()),
      new HumanMessage(buildWeeklyRecapUserPrompt(stats)),
    ])

    const text =
      typeof response.content === 'string'
        ? response.content.trim()
        : Array.isArray(response.content)
          ? response.content
              .map((part) =>
                typeof part === 'string' ? part : ((part as { text?: string }).text ?? ''),
              )
              .join('')
              .trim()
          : ''

    if (text.length < 20 || text.length > 600) {
      return buildWeeklyRecapFallback(stats)
    }

    return text
  } catch {
    return buildWeeklyRecapFallback(stats)
  }
}
