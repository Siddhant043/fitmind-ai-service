export interface WeeklyRecapStats {
  weekStart: string
  weekEnd: string
  workouts: {
    count: number
    totalVolumeKg: number
    totalDurationMin: number
    volumeChangePct: number | null
  }
  nutrition: {
    proteinHitDays: number
    proteinHitRate: number
    avgProteinG: number
    mealsLogged: number
  }
  highlight: {
    type: 'pr' | 'volume_up' | 'protein_streak' | 'consistency'
    title: string
    body: string
    metadata: Record<string, unknown>
  } | null
}

export interface WeeklyRecapRequest {
  recapId: string
  userId: string
  stats: WeeklyRecapStats
  userContextBundle: Record<string, unknown>
}

export interface WeeklyRecapResult {
  recapId: string
  userId: string
  status: 'completed' | 'failed'
  coachNarrative: string | null
  errorMessage: string | null
}
