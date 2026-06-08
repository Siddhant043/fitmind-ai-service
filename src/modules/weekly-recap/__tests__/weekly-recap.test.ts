import { describe, it, expect } from 'vitest'
import { buildWeeklyRecapFallback, buildWeeklyRecapUserPrompt } from '../weekly-recap.prompt.js'
import type { WeeklyRecapStats } from '../weekly-recap.types.js'

const sampleStats: WeeklyRecapStats = {
  weekStart: '2026-06-01',
  weekEnd: '2026-06-07',
  workouts: {
    count: 4,
    totalVolumeKg: 52400,
    totalDurationMin: 240,
    volumeChangePct: 12,
  },
  nutrition: {
    proteinHitDays: 5,
    proteinHitRate: 0.71,
    avgProteinG: 142,
    mealsLogged: 18,
  },
  highlight: {
    type: 'pr',
    title: 'New PR: Squat',
    body: '100 kg × 5',
    metadata: {},
  },
}

describe('buildWeeklyRecapUserPrompt', () => {
  it('includes workout and nutrition stats', () => {
    const prompt = buildWeeklyRecapUserPrompt(sampleStats)
    expect(prompt).toContain('4 sessions')
    expect(prompt).toContain('protein target hit 5/7 days')
    expect(prompt).toContain('New PR: Squat')
  })
})

describe('buildWeeklyRecapFallback', () => {
  it('uses provided stats without inventing data', () => {
    const narrative = buildWeeklyRecapFallback(sampleStats)
    expect(narrative).toContain('4 sessions')
    expect(narrative).toContain('5/7 days')
  })
})
