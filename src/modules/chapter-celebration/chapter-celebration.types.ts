export interface ChapterCelebrationRequest {
  userId: string
  arcId: string
  arcKey: string
  chapterIndex: number
  chapterTitle: string
  nextChapterTitle: string | null
  stats: {
    progressPct: number
    rulesSummary: string
  }
}

export interface ChapterCelebrationResult {
  userId: string
  arcId: string
  chapterIndex: number
  status: 'completed' | 'failed'
  coachNarrative: string | null
  errorMessage: string | null
}
