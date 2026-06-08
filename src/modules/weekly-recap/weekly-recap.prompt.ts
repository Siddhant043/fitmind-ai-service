import type { WeeklyRecapStats } from './weekly-recap.types.js'

export function buildWeeklyRecapSystemPrompt(): string {
  return `You are FitMind AI, a personal fitness coach writing a weekly recap closing note.
Write exactly 2-3 sentences in a warm, direct coaching voice.
Rules:
- Reference ONLY the stats provided in the user message — never invent numbers.
- Celebrate outcomes (PRs, protein consistency, volume progress) not logging frequency.
- No exclamation spam. No emojis.
- End with one forward-looking line about next week.`
}

export function buildWeeklyRecapUserPrompt(stats: WeeklyRecapStats): string {
  const highlightLine = stats.highlight
    ? `Highlight: ${stats.highlight.title} — ${stats.highlight.body}`
    : 'Highlight: none this week'

  const volumeDelta =
    stats.workouts.volumeChangePct !== null
      ? `${stats.workouts.volumeChangePct}% vs last week`
      : 'no prior week comparison'

  return `Week ${stats.weekStart} to ${stats.weekEnd}
Workouts: ${stats.workouts.count} sessions, ${stats.workouts.totalVolumeKg} kg volume (${volumeDelta})
Nutrition: protein target hit ${stats.nutrition.proteinHitDays}/7 days, ${stats.nutrition.avgProteinG}g daily average
${highlightLine}

Write the coach recap narrative.`
}

export function buildWeeklyRecapFallback(stats: WeeklyRecapStats): string {
  return `Solid week — ${stats.workouts.count} session${stats.workouts.count === 1 ? '' : 's'} and protein on ${stats.nutrition.proteinHitDays}/7 days. Keep building.`
}
