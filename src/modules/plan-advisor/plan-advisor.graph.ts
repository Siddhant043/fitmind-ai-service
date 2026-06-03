import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { buildPrimaryModel } from '../../providers/llm-provider.factory.js'
import { retrieveWithRerank } from '../rag/rag.retriever.js'
import { formatContextForPrompt } from '../context-builder/context-builder.js'
import type { UserContextBundle } from '../context-builder/context-builder.js'
import type { Redis } from 'ioredis'
import type { Channel } from 'amqplib'
import type {
  DeltaMetrics,
  SuggestionOutput,
  SuggestionType,
  PlanSuggestionResult,
} from './plan-advisor.types.js'
import { randomUUID } from 'crypto'

// ─── Delta thresholds ─────────────────────────────────────────────────────────

const PROTEIN_DEFICIT_PCT = 0.85
const PROTEIN_DEFICIT_MIN_DAYS = 5
const MISSED_WORKOUT_STREAK = 3
const CALORIE_SURPLUS_PCT = 1.1
const CALORIE_LOW_SESSIONS = 2
const VOLUME_DECLINE_PCT = 0.2

// ─── State ─────────────────────────────────────────────────────────────────────

export const PlanAdvisorState = Annotation.Root({
  userId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  triggerReason: Annotation<string>({ reducer: (_, b) => b, default: () => 'daily_cron' }),
  userContext: Annotation<UserContextBundle | null>({ reducer: (_, b) => b, default: () => null }),
  deltas: Annotation<DeltaMetrics | null>({ reducer: (_, b) => b, default: () => null }),
  issueType: Annotation<SuggestionType | null>({ reducer: (_, b) => b, default: () => null }),
  retrievedDocs: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  suggestion: Annotation<SuggestionOutput | null>({ reducer: (_, b) => b, default: () => null }),
  shouldSkip: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  redis: Annotation<Redis | null>({ reducer: (_, b) => b, default: () => null }),
  channel: Annotation<Channel | null>({ reducer: (_, b) => b, default: () => null }),
  correlationId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
})

type PlanAdvisorStateType = typeof PlanAdvisorState.State

// ─── Helpers ───────────────────────────────────────────────────────────────────

function computeDeltas(ctx: UserContextBundle): DeltaMetrics {
  const macroTarget = ctx.profile.macroTargets?.protein_g ?? 0
  const sessions = ctx.recentSessions
  const nutrition = ctx.recentNutrition ?? []

  // Protein deficit: how many of the last N days was avg protein < 85% of target
  let proteinDeficitDays = 0
  let proteinSum = 0
  for (const day of nutrition) {
    const pct = macroTarget > 0 ? day.proteinG / macroTarget : 1
    if (pct < PROTEIN_DEFICIT_PCT) proteinDeficitDays++
    proteinSum += macroTarget > 0 ? pct : 1
  }
  const avgProteinPct = nutrition.length > 0 ? proteinSum / nutrition.length : 1

  // Missed workout streak: consecutive days with no session in recent sessions
  // We approximate from gaps in recentSessions dates
  let missedWorkoutStreak = 0
  if (sessions.length > 0) {
    const latestDate = new Date(sessions[0].date)
    const today = new Date()
    const daysSinceLast = Math.floor((today.getTime() - latestDate.getTime()) / 86400000)
    missedWorkoutStreak = daysSinceLast
  } else {
    missedWorkoutStreak = 7
  }

  // Calorie surplus + low frequency
  const tdeePct = ctx.profile.tdee ?? 0
  const calTarget = ctx.profile.macroTargets?.calories ?? tdeePct
  let calorieSum = 0
  for (const day of nutrition) {
    calorieSum += calTarget > 0 ? day.calories / calTarget : 1
  }
  const avgCaloriePct = nutrition.length > 0 ? calorieSum / nutrition.length : 1

  const sessionsLast7Days = sessions.filter((s) => {
    const daysDiff = (Date.now() - new Date(s.date).getTime()) / 86400000
    return daysDiff <= 7
  }).length

  // Volume decline: compare recent 7d volume vs prior 7d
  const recentVolume = sessions
    .filter((s) => (Date.now() - new Date(s.date).getTime()) / 86400000 <= 7)
    .reduce((sum, s) => sum + (s.totalVolumeKg ?? 0), 0)

  const priorVolume = sessions
    .filter((s) => {
      const days = (Date.now() - new Date(s.date).getTime()) / 86400000
      return days > 7 && days <= 14
    })
    .reduce((sum, s) => sum + (s.totalVolumeKg ?? 0), 0)

  const volumeDeclinePct =
    priorVolume > 0 ? Math.max(0, (priorVolume - recentVolume) / priorVolume) : 0

  return {
    proteinDeficitDays,
    avgProteinPct,
    missedWorkoutStreak,
    avgCaloriePct,
    sessionsLast7Days,
    volumeDeclinePct,
  }
}

function classifyIssue(deltas: DeltaMetrics): SuggestionType | null {
  if (deltas.proteinDeficitDays >= PROTEIN_DEFICIT_MIN_DAYS) return 'nutrition'
  if (deltas.missedWorkoutStreak >= MISSED_WORKOUT_STREAK) return 'workout'
  if (
    deltas.avgCaloriePct >= CALORIE_SURPLUS_PCT &&
    deltas.sessionsLast7Days < CALORIE_LOW_SESSIONS
  )
    return 'goal'
  if (deltas.volumeDeclinePct >= VOLUME_DECLINE_PCT) return 'recovery'
  return null
}

// ─── Nodes ─────────────────────────────────────────────────────────────────────

async function loadUserData(state: PlanAdvisorStateType): Promise<Partial<PlanAdvisorStateType>> {
  if (state.userContext) return {}
  if (!state.redis) return { shouldSkip: true }
  const raw = await state.redis.get(`user_context:${state.userId}`)
  if (!raw) return { shouldSkip: true }
  try {
    const ctx = JSON.parse(raw) as UserContextBundle
    return { userContext: ctx }
  } catch {
    return { shouldSkip: true }
  }
}

async function calculateDeltas(
  state: PlanAdvisorStateType,
): Promise<Partial<PlanAdvisorStateType>> {
  if (!state.userContext) return { shouldSkip: true }
  const deltas = computeDeltas(state.userContext)
  return { deltas }
}

async function thresholdCheck(state: PlanAdvisorStateType): Promise<Partial<PlanAdvisorStateType>> {
  if (!state.deltas) return { shouldSkip: true }
  const issue = classifyIssue(state.deltas)
  if (!issue) return { shouldSkip: true }
  return { issueType: issue }
}

async function retrieveRagGuidance(
  state: PlanAdvisorStateType,
): Promise<Partial<PlanAdvisorStateType>> {
  if (!state.redis || !state.issueType || !state.userContext) return { retrievedDocs: [] }
  const namespace =
    state.issueType === 'nutrition' || state.issueType === 'goal'
      ? 'nutrition-knowledge'
      : 'fitness-knowledge'
  const query = buildRagQuery(state.issueType, state.userContext)
  const docs = await retrieveWithRerank(query, namespace, state.redis).catch(() => [] as string[])
  return { retrievedDocs: docs }
}

function buildRagQuery(issueType: SuggestionType, ctx: UserContextBundle): string {
  switch (issueType) {
    case 'nutrition':
      return `How to increase daily protein intake for ${ctx.profile.goal ?? 'fitness'} goal, dietary preference: ${ctx.profile.dietaryPref ?? 'none'}`
    case 'workout':
      return `How to resume workout routine after missing sessions, ${ctx.profile.goal ?? 'fitness'} training programme`
    case 'recovery':
      return `Signs of overtraining and recovery strategies for strength athletes`
    case 'goal':
      return `How to manage calorie surplus with low training frequency for body recomposition`
  }
}

async function generateSuggestion(
  state: PlanAdvisorStateType,
): Promise<Partial<PlanAdvisorStateType>> {
  if (!state.issueType || !state.userContext || !state.deltas) return { shouldSkip: true }

  const contextStr = formatContextForPrompt(state.userContext)
  const ragStr =
    state.retrievedDocs.length > 0
      ? `\n\n## Evidence-based guidance\n${state.retrievedDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : ''

  const systemPrompt = `You are FitMind AI, an adaptive fitness coach. Analyse the user's data and generate a single proactive coaching suggestion.

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "suggestionType": "${state.issueType}",
  "content": "One concrete, actionable suggestion (2-3 sentences max)",
  "reasoning": "Brief explanation of the data pattern that triggered this (1-2 sentences)",
  "dataSnapshot": {
    "metric": "description of key metric",
    "value": "current value",
    "target": "target value",
    "trend": "description of trend"
  }
}${ragStr}`

  const userMsg = `User context:\n${contextStr}\n\nData deltas:\n${JSON.stringify(state.deltas, null, 2)}\n\nIssue type: ${state.issueType}`

  const model = buildPrimaryModel('chat')
  const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userMsg)])
  const raw = typeof response.content === 'string' ? response.content.trim() : ''

  try {
    const parsed = JSON.parse(raw) as SuggestionOutput
    return { suggestion: parsed }
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return { suggestion: JSON.parse(jsonMatch[0]) as SuggestionOutput }
      } catch {
        // fall through
      }
    }
    return {
      suggestion: {
        suggestionType: state.issueType,
        content: raw.slice(0, 500),
        reasoning: 'Generated from data pattern analysis',
        dataSnapshot: { deltas: state.deltas },
      },
    }
  }
}

async function dedupCheck(state: PlanAdvisorStateType): Promise<Partial<PlanAdvisorStateType>> {
  if (!state.redis || !state.issueType) return {}
  const key = `plan_suggestion_dedup:${state.userId}:${state.triggerReason}:${state.issueType}`
  const exists = await state.redis.get(key)
  if (exists) {
    return { shouldSkip: true }
  }
  const TTL_7D = 7 * 24 * 60 * 60
  await state.redis.set(key, '1', 'EX', TTL_7D)
  return {}
}

async function publishResult(state: PlanAdvisorStateType): Promise<Partial<PlanAdvisorStateType>> {
  if (!state.channel || !state.suggestion) return {}

  const result: PlanSuggestionResult = {
    userId: state.userId,
    suggestionType: state.suggestion.suggestionType,
    content: state.suggestion.content,
    reasoning: state.suggestion.reasoning,
    dataSnapshot: state.suggestion.dataSnapshot,
    status: 'completed',
    errorMessage: null,
  }

  const envelope = {
    messageId: randomUUID(),
    correlationId: state.correlationId || randomUUID(),
    timestamp: new Date().toISOString(),
    version: '1.0',
    source: 'ai-service',
    type: 'plan.suggestion.result',
    payload: result,
    metadata: { userId: state.userId, traceId: randomUUID() },
  }

  state.channel.publish('fitmind.direct', 'plan.result', Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
  })
  return {}
}

// ─── Graph ─────────────────────────────────────────────────────────────────────

const graph = new StateGraph(PlanAdvisorState)
  .addNode('load_user_data', loadUserData)
  .addNode('calculate_deltas', calculateDeltas)
  .addNode('threshold_check', thresholdCheck)
  .addNode('classify_issue', async (s) => s) // merged into thresholdCheck via issueType
  .addNode('retrieve_rag_guidance', retrieveRagGuidance)
  .addNode('generate_suggestion', generateSuggestion)
  .addNode('dedup_check', dedupCheck)
  .addNode('publish_result', publishResult)
  .addEdge(START, 'load_user_data')
  .addConditionalEdges('load_user_data', (s) => (s.shouldSkip ? END : 'calculate_deltas'))
  .addConditionalEdges('calculate_deltas', (s) => (s.shouldSkip ? END : 'threshold_check'))
  .addConditionalEdges('threshold_check', (s) => (s.shouldSkip ? END : 'retrieve_rag_guidance'))
  .addEdge('retrieve_rag_guidance', 'generate_suggestion')
  .addConditionalEdges('generate_suggestion', (s) => (s.shouldSkip ? END : 'dedup_check'))
  .addConditionalEdges('dedup_check', (s) => (s.shouldSkip ? END : 'publish_result'))
  .addEdge('publish_result', END)

export const planAdvisorGraph = graph.compile()

export {
  computeDeltas,
  classifyIssue,
  PROTEIN_DEFICIT_PCT,
  PROTEIN_DEFICIT_MIN_DAYS,
  MISSED_WORKOUT_STREAK,
}
