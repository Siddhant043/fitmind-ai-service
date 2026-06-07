import { Annotation, StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { RunnableConfig } from '@langchain/core/runnables'
import { buildPrimaryModel, buildFallbackModel } from '../../providers/llm-provider.factory.js'
import { invokeWithFallback, streamWithFallback } from '../../providers/llm-with-fallback.js'
import { retrieveWithRerank } from '../rag/rag.retriever.js'
import { formatContextForPrompt } from '../context-builder/context-builder.js'
import type { UserContextBundle } from '../context-builder/context-builder.js'
import type { Redis } from 'ioredis'
import type { Channel } from 'amqplib'
import {
  extractWorkoutPlanAction,
  extractWorkoutDayAction,
  type WorkoutActionPayload,
} from './workout-action-extractor.js'
import { buildChatTools } from './tools/index.js'

// ─── State ────────────────────────────────────────────────────────────────────

const ChatState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userContext: Annotation<UserContextBundle | null>({ reducer: (_, b) => b, default: () => null }),
  intent: Annotation<string>({ reducer: (_, b) => b, default: () => 'general' }),
  retrievedDocs: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  sessionId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  streamCallback: Annotation<((token: string) => void) | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  workoutAction: Annotation<WorkoutActionPayload | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
})

type ChatStateType = typeof ChatState.State

interface ChatConfigurable {
  redis?: Redis
  channel?: Channel
  userId?: string
}

const HISTORY_INTENTS = new Set(['workout_history', 'meal_history', 'progress_review'])
const PLAN_CREATE_INTENTS = new Set(['workout_plan_create', 'workout_day_create'])

// ─── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are FitMind AI, a knowledgeable and motivating personal trainer and sports nutritionist.
You specialise in helping Indian gym-goers achieve their fitness and nutrition goals.
Be concise, practical, and encouraging. Use metric units. When discussing Indian food, be specific and culturally relevant.
Never provide medical diagnoses or replace professional medical advice.

When the user asks about their own workouts, meals, or progress, use the available tools to fetch their logged data.
Never invent exercises, sets, or meals that are not present in tool results. Cite specific numbers from tool output.
If no data exists, say so clearly and offer general guidance.`

const SAFETY_KEYWORDS =
  /\b(diagnos|prescri|medication|surgery|injury|pain|doctor|hospital|medical advice)\b/i

function buildSystemPrompt(state: ChatStateType): string {
  const contextSection = state.userContext
    ? `\n\n## User Profile\n${formatContextForPrompt(state.userContext)}`
    : ''
  const ragSection =
    state.retrievedDocs.length > 0
      ? `\n\n## Reference Knowledge\n${state.retrievedDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : ''
  return BASE_SYSTEM_PROMPT + contextSection + ragSection
}

function buildHistoryDataSection(state: ChatStateType): string {
  const ctx = state.userContext
  if (!ctx) return ''

  const sections: string[] = []
  if (ctx.lastMealDetail) {
    sections.push(`## Last Meal Data\n${JSON.stringify(ctx.lastMealDetail, null, 2)}`)
  }
  if (ctx.lastWorkoutDetail) {
    sections.push(`## Last Workout Data\n${JSON.stringify(ctx.lastWorkoutDetail, null, 2)}`)
  }
  if (ctx.recentMeals && ctx.recentMeals.length > 0) {
    sections.push(`## Recent Meals\n${JSON.stringify(ctx.recentMeals, null, 2)}`)
  }

  if (sections.length === 0) return ''
  return `\n\nUse the personal data sections below as the source of truth. Cite specific numbers from this data.\n\n${sections.join('\n\n')}`
}

function hasHistoryContextForIntent(state: ChatStateType): boolean {
  const ctx = state.userContext
  if (!ctx) return false

  if (state.intent === 'meal_history') {
    return Boolean(ctx.lastMealDetail || (ctx.recentMeals && ctx.recentMeals.length > 0))
  }
  if (state.intent === 'workout_history') {
    return Boolean(ctx.lastWorkoutDetail)
  }
  if (state.intent === 'progress_review') {
    return Boolean(
      ctx.lastMealDetail ||
      ctx.lastWorkoutDetail ||
      (ctx.recentMeals && ctx.recentMeals.length > 0) ||
      (ctx.recentSessions && ctx.recentSessions.length > 0),
    )
  }
  return false
}

function bindToolsIfAvailable(
  model: ReturnType<typeof buildPrimaryModel>,
  tools: ReturnType<typeof buildChatTools>,
) {
  if (tools.length === 0 || typeof model.bindTools !== 'function') {
    return model
  }
  return model.bindTools(tools)
}

function getConfigurable(config: RunnableConfig): ChatConfigurable {
  return (config.configurable ?? {}) as ChatConfigurable
}

function buildToolsForConfig(config: RunnableConfig) {
  const { redis, channel, userId } = getConfigurable(config)
  if (!redis || !channel || !userId) {
    return []
  }
  return buildChatTools({ userId, redis, channel })
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

async function classifyIntent(state: ChatStateType): Promise<Partial<ChatStateType>> {
  const lastMessage = state.messages.at(-1)
  const text = lastMessage && 'content' in lastMessage ? String(lastMessage.content) : ''

  if (SAFETY_KEYWORDS.test(text)) return { intent: 'safety' }

  const model = buildPrimaryModel('fast')
  const fallback = buildFallbackModel('fast')
  const response = (await invokeWithFallback(model, fallback, [
    new SystemMessage(
      `Classify the following fitness/nutrition message into ONE of these intents:
- fitness_rag: general fitness training knowledge (not about the user's own logs)
- nutrition_rag: general nutrition/diet knowledge (not about the user's own logs)
- workout_plan_create: user asks to create/design/make/build a workout plan, program, routine, or split
- workout_day_create: user asks to create/make/give a single workout day (e.g. push/pull/leg/chest/back/arm day)
- workout_history: user asks about THEIR OWN past/recent/last workout, exercise performance, weak lifts, or session review
- meal_history: user asks about THEIR OWN logged meals, last meal, or how to improve a meal they ate
- progress_review: user asks why they are not progressing, getting stronger, or how they are doing overall
- general: everything else

Reply with only the intent name.`,
    ),
    new HumanMessage(text),
  ])) as { content: unknown }
  const raw =
    typeof response.content === 'string' ? response.content.trim().toLowerCase() : 'general'
  const knownIntents = [
    'fitness_rag',
    'nutrition_rag',
    'workout_plan_create',
    'workout_day_create',
    'workout_history',
    'meal_history',
    'progress_review',
  ] as const
  const intent = knownIntents.includes(raw as (typeof knownIntents)[number]) ? raw : 'general'
  return { intent }
}

async function retrieveFitnessRag(
  state: ChatStateType,
  config: { configurable?: { redis?: Redis } },
): Promise<Partial<ChatStateType>> {
  const redis = config.configurable?.redis
  if (!redis) return { retrievedDocs: [] }
  const lastMessage = state.messages.at(-1)
  const query = lastMessage && 'content' in lastMessage ? String(lastMessage.content) : ''
  const docs = await retrieveWithRerank(query, 'fitness-knowledge', redis).catch(
    () => [] as string[],
  )
  return { retrievedDocs: docs }
}

async function retrieveNutritionRag(
  state: ChatStateType,
  config: { configurable?: { redis?: Redis } },
): Promise<Partial<ChatStateType>> {
  const redis = config.configurable?.redis
  if (!redis) return { retrievedDocs: [] }
  const lastMessage = state.messages.at(-1)
  const query = lastMessage && 'content' in lastMessage ? String(lastMessage.content) : ''
  const docs = await retrieveWithRerank(query, 'nutrition-knowledge', redis).catch(
    () => [] as string[],
  )
  return { retrievedDocs: docs }
}

async function callAgent(
  state: ChatStateType,
  config: RunnableConfig,
): Promise<Partial<ChatStateType>> {
  const tools = buildToolsForConfig(config)
  const streamCallback = state.streamCallback

  if (HISTORY_INTENTS.has(state.intent) && streamCallback) {
    streamCallback('Looking up your logged data...\n\n')
  }

  const baseModel = buildPrimaryModel('chat')
  const fallbackModel = buildFallbackModel('chat')
  const model = bindToolsIfAvailable(baseModel, tools)
  const fallbackWithTools =
    fallbackModel && tools.length > 0 ? bindToolsIfAvailable(fallbackModel, tools) : fallbackModel

  const response = (await invokeWithFallback(model, fallbackWithTools, [
    new SystemMessage(buildSystemPrompt(state)),
    ...state.messages,
  ])) as AIMessage

  return { messages: [response] }
}

async function executeTools(
  state: ChatStateType,
  config: RunnableConfig,
): Promise<Partial<ChatStateType>> {
  const tools = buildToolsForConfig(config)
  if (tools.length === 0) {
    return { messages: [] }
  }
  const toolNode = new ToolNode(tools)
  const result = await toolNode.invoke(state, config)
  return result as Partial<ChatStateType>
}

async function generateHistoryResponse(state: ChatStateType): Promise<Partial<ChatStateType>> {
  const systemPrompt = buildSystemPrompt(state) + buildHistoryDataSection(state)
  const primary = buildPrimaryModel('chat')
  const fallback = buildFallbackModel('chat')
  const allMessages = [new SystemMessage(systemPrompt), ...state.messages]
  const streamCallback = state.streamCallback

  if (streamCallback) {
    streamCallback('Looking up your logged data...\n\n')
    const fullContent = await streamWithFallback(primary, fallback, allMessages, streamCallback)
    return { messages: [new AIMessage(fullContent)] }
  }

  const response = (await invokeWithFallback(primary, fallback, allMessages)) as {
    content: unknown
  }
  const fullContent =
    typeof response.content === 'string' ? response.content : String(response.content)
  return { messages: [new AIMessage(fullContent)] }
}

async function generateResponse(state: ChatStateType): Promise<Partial<ChatStateType>> {
  const systemPrompt = buildSystemPrompt(state)
  const primary = buildPrimaryModel('chat')
  const fallback = buildFallbackModel('chat')
  const allMessages = [new SystemMessage(systemPrompt), ...state.messages]

  const streamCallback = state.streamCallback
  let fullContent = ''

  if (streamCallback) {
    fullContent = await streamWithFallback(primary, fallback, allMessages, streamCallback)
  } else {
    const response = (await invokeWithFallback(primary, fallback, allMessages)) as {
      content: unknown
    }
    fullContent = typeof response.content === 'string' ? response.content : ''
  }

  return { messages: [new AIMessage(fullContent)] }
}

async function streamFinalResponse(state: ChatStateType): Promise<Partial<ChatStateType>> {
  const streamCallback = state.streamCallback
  const lastMessage = state.messages.at(-1)

  if (!lastMessage || !(lastMessage instanceof AIMessage)) {
    return {}
  }

  const existingContent =
    typeof lastMessage.content === 'string' ? lastMessage.content : String(lastMessage.content)

  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return {}
  }

  if (!streamCallback || !existingContent.trim()) {
    return {}
  }

  streamCallback(existingContent)
  return { messages: [new AIMessage(existingContent)] }
}

function lastAssistantText(state: ChatStateType): string {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]
    if (!message) continue
    if (message instanceof AIMessage || message._getType?.() === 'ai') {
      const content = message.content
      return typeof content === 'string' ? content : String(content)
    }
  }
  return ''
}

async function extractWorkoutStructure(state: ChatStateType): Promise<Partial<ChatStateType>> {
  const lastAI = lastAssistantText(state)
  if (!lastAI.trim()) return { workoutAction: null }

  const model = buildPrimaryModel('fast') as Parameters<typeof extractWorkoutPlanAction>[1]
  if (state.intent === 'workout_plan_create') {
    const action = await extractWorkoutPlanAction(lastAI, model)
    return { workoutAction: action }
  }
  if (state.intent === 'workout_day_create') {
    const action = await extractWorkoutDayAction(lastAI, model)
    return { workoutAction: action }
  }
  return { workoutAction: null }
}

async function safetyRedirect(_state: ChatStateType): Promise<Partial<ChatStateType>> {
  const message =
    "I'm not able to provide medical diagnoses or replace professional medical advice. For any injury, pain, or health concern, please consult a qualified healthcare professional. I'm here to help with fitness programming, nutrition planning, and general wellness guidance!"
  return { messages: [new AIMessage(message)] }
}

function routeAfterAgent(state: ChatStateType): string {
  const lastMessage = state.messages.at(-1)
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    return 'tools'
  }
  if (state.streamCallback) {
    return 'stream_final_response'
  }
  return END
}

// ─── Graph ────────────────────────────────────────────────────────────────────

const graph = new StateGraph(ChatState)
  .addNode('classify_intent', classifyIntent)
  .addNode('retrieve_fitness_rag', retrieveFitnessRag)
  .addNode('retrieve_nutrition_rag', retrieveNutritionRag)
  .addNode('agent', callAgent)
  .addNode('tools', executeTools)
  .addNode('generate_response', generateResponse)
  .addNode('generate_history_response', generateHistoryResponse)
  .addNode('stream_final_response', streamFinalResponse)
  .addNode('extract_workout_structure', extractWorkoutStructure)
  .addNode('safety_redirect', safetyRedirect)
  .addEdge(START, 'classify_intent')
  .addConditionalEdges('classify_intent', (state) => {
    if (state.intent === 'safety') return 'safety_redirect'
    if (state.intent === 'fitness_rag') return 'retrieve_fitness_rag'
    if (state.intent === 'nutrition_rag') return 'retrieve_nutrition_rag'
    if (PLAN_CREATE_INTENTS.has(state.intent)) return 'generate_response'
    if (state.intent === 'general') return 'generate_response'
    if (HISTORY_INTENTS.has(state.intent) && hasHistoryContextForIntent(state)) {
      return 'generate_history_response'
    }
    return 'agent'
  })
  .addEdge('retrieve_fitness_rag', 'agent')
  .addEdge('retrieve_nutrition_rag', 'agent')
  .addConditionalEdges('agent', routeAfterAgent, {
    tools: 'tools',
    stream_final_response: 'stream_final_response',
    [END]: END,
  })
  .addEdge('tools', 'agent')
  .addEdge('generate_history_response', END)
  .addEdge('stream_final_response', END)
  .addConditionalEdges('generate_response', (state) => {
    if (PLAN_CREATE_INTENTS.has(state.intent)) {
      return 'extract_workout_structure'
    }
    return END
  })
  .addEdge('extract_workout_structure', END)
  .addEdge('safety_redirect', END)

export const checkpointer = new MemorySaver()
export const chatbotGraph = graph.compile({ checkpointer })

export type { ChatStateType }
