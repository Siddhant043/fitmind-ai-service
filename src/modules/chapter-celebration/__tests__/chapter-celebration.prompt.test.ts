import { describe, expect, it } from 'vitest'
import { buildChapterCelebrationFallback } from '../chapter-celebration.prompt.js'

describe('buildChapterCelebrationFallback', () => {
  it('returns non-empty copy with next chapter', () => {
    const text = buildChapterCelebrationFallback({
      userId: 'u1',
      arcId: 'a1',
      arcKey: 'cut_reveal',
      chapterIndex: 0,
      chapterTitle: 'Foundation',
      nextChapterTitle: 'Protein Consistency',
      stats: { progressPct: 100, rulesSummary: '2 workouts' },
    })
    expect(text.length).toBeGreaterThan(20)
    expect(text).toContain('Foundation')
    expect(text).toContain('Protein Consistency')
  })

  it('returns final-chapter copy when no next chapter', () => {
    const text = buildChapterCelebrationFallback({
      userId: 'u1',
      arcId: 'a1',
      arcKey: 'cut_reveal',
      chapterIndex: 4,
      chapterTitle: 'Target Check-in',
      nextChapterTitle: null,
      stats: { progressPct: 100, rulesSummary: 'body trend' },
    })
    expect(text).toContain('Target Check-in')
    expect(text).toContain('complete')
  })
})
