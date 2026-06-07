import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Redis } from 'ioredis'

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockFastInvoke, mockChatInvoke, mockChatStream, mockRetrieve } = vi.hoisted(() => ({
  mockFastInvoke: vi.fn().mockResolvedValue({ content: 'general' }),
  mockChatInvoke: vi.fn().mockResolvedValue({ content: 'Here is your fitness advice.' }),
  mockChatStream: vi.fn().mockImplementation(async function* () {
    yield { content: 'Hello' }
    yield { content: ' world' }
  }),
  mockRetrieve: vi.fn().mockResolvedValue(['retrieved-doc-1', 'retrieved-doc-2']),
}))

vi.mock('../../../providers/llm-provider.factory.js', () => ({
  buildPrimaryModel: vi.fn().mockImplementation((task: string) => {
    if (task === 'fast') return { invoke: mockFastInvoke }
    const chatModel = { invoke: mockChatInvoke, stream: mockChatStream, bindTools: vi.fn() }
    chatModel.bindTools.mockReturnValue({ invoke: mockChatInvoke })
    return chatModel
  }),
  buildFallbackModel: vi.fn().mockReturnValue(null),
}))

vi.mock('../tools/index.js', () => ({
  buildChatTools: vi.fn().mockReturnValue([]),
}))

vi.mock('../../rag/rag.retriever.js', () => ({
  retrieveWithRerank: mockRetrieve,
}))

import { chatbotGraph } from '../chatbot.graph.js'
import { HumanMessage, AIMessage } from '@langchain/core/messages'

// ── helpers ───────────────────────────────────────────────────────────────────

function buildMockRedis(): Redis {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis
}

let threadCounter = 0
function nextThread() {
  return `test-thread-${++threadCounter}`
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFastInvoke.mockResolvedValue({ content: 'general' })
  mockChatInvoke.mockResolvedValue(new AIMessage({ content: 'Here is your fitness advice.' }))
  mockChatStream.mockImplementation(async function* () {
    yield { content: 'Hello' }
    yield { content: ' world' }
  })
  mockRetrieve.mockResolvedValue(['retrieved-doc-1'])
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('chatbotGraph — safety routing', () => {
  it('routes to safetyRedirect when message contains a safety keyword', async () => {
    const result = await chatbotGraph.invoke(
      {
        messages: [new HumanMessage('I have a knee injury, what should I do?')],
        streamCallback: null,
      },
      { configurable: { thread_id: nextThread() } },
    )
    const lastMsg = result.messages.at(-1)
    expect(String(lastMsg?.content)).toContain("I'm not able to provide medical diagnoses")
    expect(result.intent).toBe('safety')
  })

  it('does not call buildPrimaryModel for classification on safety keyword', async () => {
    await chatbotGraph.invoke(
      { messages: [new HumanMessage('I have shoulder pain after surgery')], streamCallback: null },
      { configurable: { thread_id: nextThread() } },
    )
    expect(mockFastInvoke).not.toHaveBeenCalled()
  })
})

describe('chatbotGraph — fitness_rag routing', () => {
  it('calls retrieveWithRerank with fitness-knowledge namespace', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'fitness_rag' })

    await chatbotGraph.invoke(
      {
        messages: [new HumanMessage('How to improve my squat depth?')],
        streamCallback: null,
      },
      { configurable: { thread_id: nextThread(), redis: buildMockRedis() } },
    )

    expect(mockRetrieve).toHaveBeenCalledWith(
      expect.any(String),
      'fitness-knowledge',
      expect.anything(),
    )
  })
})

describe('chatbotGraph — nutrition_rag routing', () => {
  it('calls retrieveWithRerank with nutrition-knowledge namespace', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'nutrition_rag' })

    await chatbotGraph.invoke(
      {
        messages: [new HumanMessage('How much protein do I need for muscle gain?')],
        streamCallback: null,
      },
      { configurable: { thread_id: nextThread(), redis: buildMockRedis() } },
    )

    expect(mockRetrieve).toHaveBeenCalledWith(
      expect.any(String),
      'nutrition-knowledge',
      expect.anything(),
    )
  })
})

describe('chatbotGraph — general routing (no RAG)', () => {
  it('does not call retrieveWithRerank for general intent', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'general' })

    await chatbotGraph.invoke(
      { messages: [new HumanMessage('Tell me a fitness joke')], streamCallback: null },
      { configurable: { thread_id: nextThread(), userId: 'u1' } },
    )

    expect(mockRetrieve).not.toHaveBeenCalled()
    expect(mockChatInvoke).toHaveBeenCalled()
  })
})

describe('chatbotGraph — streaming', () => {
  it('calls streamCallback for each token when provided', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'general' })
    const streamCallback = vi.fn()

    await chatbotGraph.invoke(
      { messages: [new HumanMessage('Motivate me to workout')], streamCallback },
      { configurable: { thread_id: nextThread(), userId: 'u1' } },
    )

    expect(streamCallback).toHaveBeenCalledWith('Hello')
    expect(streamCallback).toHaveBeenCalledWith(' world')
    expect(mockChatStream).toHaveBeenCalled()
  })

  it('uses model.invoke (not stream) when streamCallback is null', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'general' })

    await chatbotGraph.invoke(
      { messages: [new HumanMessage('What is TDEE?')], streamCallback: null },
      { configurable: { thread_id: nextThread(), userId: 'u1' } },
    )

    expect(mockChatInvoke).toHaveBeenCalled()
    expect(mockChatStream).not.toHaveBeenCalled()
  })
})

describe('chatbotGraph — meal_history fast path', () => {
  it('uses lastMealDetail from context without agent tool loop', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'meal_history' })

    const userContext = {
      userId: 'u1',
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'Raj',
        sex: 'male',
        ageYears: 25,
        weightKg: 75,
        heightCm: 175,
        goal: 'build_muscle',
        activityLevel: 'high',
        dietaryPref: null,
        tdee: 2800,
        macroTargets: null,
        subscriptionTier: 'pro' as const,
      },
      activePlan: null,
      recentSessions: [],
      todayNutrition: null,
      stats: { totalWorkouts: 10, currentStreakDays: 3 },
      lastMealDetail: {
        mealId: 'meal-1',
        loggedAt: '2026-06-05T12:00:00.000Z',
        mealType: 'lunch',
        description: 'Chicken biryani',
        macros: { calories: 650, proteinG: 35, carbsG: 70, fatsG: 22 },
        mealFeedback: null,
        vsDailyTarget: null,
      },
    }

    await chatbotGraph.invoke(
      {
        messages: [new HumanMessage('How could I improve my last meal?')],
        streamCallback: null,
        userContext,
      },
      { configurable: { thread_id: nextThread(), userId: 'u1' } },
    )

    expect(mockChatInvoke).toHaveBeenCalledTimes(1)
    const callArgs = mockChatInvoke.mock.calls[0]?.[0] as Array<{ content: string }> | undefined
    const systemMsg = callArgs?.find((m) => m.content?.includes('Last Meal Data'))
    expect(systemMsg).toBeDefined()
  })
})

describe('chatbotGraph — workout_history routing', () => {
  it('routes workout history questions to agent without RAG', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'workout_history' })

    await chatbotGraph.invoke(
      {
        messages: [new HumanMessage('How can I improve my last workout?')],
        streamCallback: null,
      },
      { configurable: { thread_id: nextThread(), userId: 'u1', redis: buildMockRedis() } },
    )

    expect(mockRetrieve).not.toHaveBeenCalled()
    expect(mockChatInvoke).toHaveBeenCalled()
  })
})

describe('chatbotGraph — user context injection', () => {
  it('injects user context section into system prompt when provided', async () => {
    mockFastInvoke.mockResolvedValue({ content: 'general' })

    const userContext = {
      userId: 'u1',
      updatedAt: new Date().toISOString(),
      profile: {
        name: 'Raj',
        sex: 'male',
        ageYears: 25,
        weightKg: 75,
        heightCm: 175,
        goal: 'build_muscle',
        activityLevel: 'high',
        dietaryPref: null,
        tdee: 2800,
        macroTargets: null,
        subscriptionTier: 'pro' as const,
      },
      activePlan: null,
      recentSessions: [],
      todayNutrition: null,
      stats: { totalWorkouts: 10, currentStreakDays: 3 },
    }

    await chatbotGraph.invoke(
      {
        messages: [new HumanMessage('What should I eat post workout?')],
        streamCallback: null,
        userContext,
      },
      { configurable: { thread_id: nextThread(), userId: 'u1' } },
    )

    // The model.invoke should have been called with a system prompt containing user profile info
    const callArgs = mockChatInvoke.mock.calls[0]?.[0] as Array<{ content: string }> | undefined
    const systemMsg = callArgs?.find((m) => m.content?.includes('Raj'))
    expect(systemMsg).toBeDefined()
  })
})
