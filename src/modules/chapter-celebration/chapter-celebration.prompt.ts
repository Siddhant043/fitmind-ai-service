import type { ChapterCelebrationRequest } from './chapter-celebration.types.js'

export function buildChapterCelebrationSystemPrompt(): string {
  return `You are FitMind AI, a personal fitness coach celebrating a journey chapter completion.
Write exactly 2-3 sentences in a warm, identity-reframing coaching voice.
Rules:
- Acknowledge the chapter they just completed and what it means for who they are becoming.
- If a next chapter is provided, preview it briefly — do not list rules or criteria.
- Reference only context provided — never invent stats.
- No exclamation spam. No emojis.`
}

export function buildChapterCelebrationUserPrompt(
  request: ChapterCelebrationRequest,
  contextSummary: string,
): string {
  const nextLine = request.nextChapterTitle
    ? `Next chapter: ${request.nextChapterTitle}`
    : 'This was the final chapter in their arc.'

  return `Completed chapter: "${request.chapterTitle}" (index ${request.chapterIndex})
Arc: ${request.arcKey}
Criteria met: ${request.stats.rulesSummary}
${nextLine}

User context:
${contextSummary}

Write the coach celebration narrative.`
}

export function buildChapterCelebrationFallback(request: ChapterCelebrationRequest): string {
  if (request.nextChapterTitle) {
    return `You cleared "${request.chapterTitle}" — that's real progress, not just logging. Next up: ${request.nextChapterTitle}.`
  }
  return `You finished "${request.chapterTitle}" — the arc is complete. This is who you've become through the work.`
}
