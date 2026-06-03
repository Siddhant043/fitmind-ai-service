import { Annotation, StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { buildPrimaryModel } from '../../providers/llm-provider.factory.js'
import { retrieveWithRerank } from '../rag/rag.retriever.js'
import { formatContextForPrompt } from '../context-builder/context-builder.js'
import type { UserContextBundle } from '../context-builder/context-builder.js'
import type { Redis } from 'ioredis'

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
})

type ChatStateType = typeof ChatState.State

// ─── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are FitMind AI, a knowledgeable and motivating personal trainer and sports nutritionist.
You specialise in helping Indian gym-goers achieve their fitness and nutrition goals.
Be concise, practical, and encouraging. Use metric units. When discussing Indian food, be specific and culturally relevant.
Never provide medical diagnoses or replace professional medical advice.`

const SAFETY_KEYWORDS =
  /\b(diagnos|prescri|medication|surgery|injury|pain|doctor|hospital|medical advice)\b/i

// ─── Nodes ────────────────────────────────────────────────────────────────────

async function classifyIntent(state: ChatStateType): Promise<Partial<ChatStateType>> {
  const lastMessage = state.messages.at(-1)
  const text = lastMessage && 'content' in lastMessage ? String(lastMessage.content) : ''

  if (SAFETY_KEYWORDS.test(text)) return { intent: 'safety' }

  const model = buildPrimaryModel('fast')
  const response = await model.invoke([
    new SystemMessage(
      'Classify the following fitness/nutrition question into ONE of these intents: fitness_rag, nutrition_rag, general. Reply with only the intent name.',
    ),
    new HumanMessage(text),
  ])
  const raw =
    typeof response.content === 'string' ? response.content.trim().toLowerCase() : 'general'
  const intent = ['fitness_rag', 'nutrition_rag'].includes(raw) ? raw : 'general'
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

async function generateResponse(state: ChatStateType): Promise<Partial<ChatStateType>> {
  const contextSection = state.userContext
    ? `\n\n## User Profile\n${formatContextForPrompt(state.userContext)}`
    : ''
  const ragSection =
    state.retrievedDocs.length > 0
      ? `\n\n## Reference Knowledge\n${state.retrievedDocs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : ''

  const systemPrompt = BASE_SYSTEM_PROMPT + contextSection + ragSection

  const model = buildPrimaryModel('chat')
  const allMessages = [new SystemMessage(systemPrompt), ...state.messages]

  const streamCallback = state.streamCallback
  let fullContent = ''

  if (streamCallback) {
    const stream = await model.stream(allMessages)
    for await (const chunk of stream) {
      const token = typeof chunk.content === 'string' ? chunk.content : ''
      if (token) {
        fullContent += token
        streamCallback(token)
      }
    }
  } else {
    const response = await model.invoke(allMessages)
    fullContent = typeof response.content === 'string' ? response.content : ''
  }

  return { messages: [new AIMessage(fullContent)] }
}

async function safetyRedirect(_state: ChatStateType): Promise<Partial<ChatStateType>> {
  const message =
    "I'm not able to provide medical diagnoses or replace professional medical advice. For any injury, pain, or health concern, please consult a qualified healthcare professional. I'm here to help with fitness programming, nutrition planning, and general wellness guidance!"
  return { messages: [new AIMessage(message)] }
}

// ─── Graph ────────────────────────────────────────────────────────────────────

const graph = new StateGraph(ChatState)
  .addNode('classify_intent', classifyIntent)
  .addNode('retrieve_fitness_rag', retrieveFitnessRag)
  .addNode('retrieve_nutrition_rag', retrieveNutritionRag)
  .addNode('generate_response', generateResponse)
  .addNode('safety_redirect', safetyRedirect)
  .addEdge(START, 'classify_intent')
  .addConditionalEdges('classify_intent', (state) => {
    if (state.intent === 'safety') return 'safety_redirect'
    if (state.intent === 'fitness_rag') return 'retrieve_fitness_rag'
    if (state.intent === 'nutrition_rag') return 'retrieve_nutrition_rag'
    return 'generate_response'
  })
  .addEdge('retrieve_fitness_rag', 'generate_response')
  .addEdge('retrieve_nutrition_rag', 'generate_response')
  .addEdge('generate_response', END)
  .addEdge('safety_redirect', END)

export const checkpointer = new MemorySaver()
export const chatbotGraph = graph.compile({ checkpointer })

export type { ChatStateType }
