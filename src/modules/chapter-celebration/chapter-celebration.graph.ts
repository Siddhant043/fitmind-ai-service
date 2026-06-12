import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { buildPrimaryModel } from '../../providers/llm-provider.factory.js'
import { formatContextForPrompt } from '../context-builder/context-builder.js'
import type { UserContextBundle } from '../context-builder/context-builder.js'
import type { ChapterCelebrationRequest } from './chapter-celebration.types.js'
import {
  buildChapterCelebrationFallback,
  buildChapterCelebrationSystemPrompt,
  buildChapterCelebrationUserPrompt,
} from './chapter-celebration.prompt.js'

export async function generateChapterCelebrationNarrative(
  request: ChapterCelebrationRequest,
  userContext: UserContextBundle | null,
): Promise<string> {
  const contextSummary = userContext
    ? formatContextForPrompt(userContext)
    : 'No user context available.'

  try {
    const model = buildPrimaryModel('fast')
    const response = await model.invoke([
      new SystemMessage(buildChapterCelebrationSystemPrompt()),
      new HumanMessage(buildChapterCelebrationUserPrompt(request, contextSummary)),
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
      return buildChapterCelebrationFallback(request)
    }

    return text
  } catch {
    return buildChapterCelebrationFallback(request)
  }
}
