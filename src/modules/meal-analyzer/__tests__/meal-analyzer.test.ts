import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Channel, ConsumeMessage } from 'amqplib'
import { startMealAnalyzerWorker } from '../meal-analyzer.worker.js'
import { mealAnalyzerOutputSchema } from '../meal-analyzer.prompt.js'

const mockPrimaryInvoke = vi.fn()
const mockFallbackInvoke = vi.fn()

vi.mock('../../../providers/llm-provider.factory.js', () => ({
  buildPrimaryModel: vi.fn().mockReturnValue({
    withStructuredOutput: vi
      .fn()
      .mockReturnValue({ invoke: async (...args: unknown[]) => mockPrimaryInvoke(...args) }),
  }),
  buildFallbackModel: vi.fn().mockReturnValue({
    withStructuredOutput: vi
      .fn()
      .mockReturnValue({ invoke: async (...args: unknown[]) => mockFallbackInvoke(...args) }),
  }),
  buildAlternatePrimaryModel: vi.fn().mockReturnValue(null),
  resolveStructuredOutputMethod: vi.fn().mockReturnValue('functionCalling'),
}))

describe('Meal Analyzer AI Worker Unit Tests', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockChannel: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRedis: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFetch: any
  let originalFetch: typeof fetch

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrimaryInvoke.mockReset()
    mockFallbackInvoke.mockReset()

    mockRedis = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          profile: {
            goal: 'cut',
            tdee: 2200,
            macroTargets: { calories: 2000, protein_g: 150, carbs_g: 200, fats_g: 65 },
            countryCode: 'IN',
            dietaryPref: 'vegetarian',
          },
          todayNutrition: { calories: 800, proteinG: 40 },
          activePlan: { name: 'PPL' },
        }),
      ),
    }

    // Setup channel mock
    mockChannel = {
      prefetch: vi.fn(),
      consume: vi.fn(),
      ack: vi.fn(),
      nack: vi.fn(),
      publish: vi.fn(),
    }

    // Mock fetch
    originalFetch = global.fetch
    mockFetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('127.0.0.1:7886')) {
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: async () => Buffer.from('fake-image-bytes'),
        headers: {
          get: (name: string) => (name === 'content-type' ? 'image/png' : null),
        },
      })
    })
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('successfully processes a meal with a description and image using the primary model', async () => {
    // Mock primary output
    const mockOutput = {
      foods_detected: [
        {
          name: 'Paneer Butter Masala',
          quantity: '1 bowl',
          calories: 320,
          proteinG: 12,
          carbsG: 10,
          fatsG: 25,
          fiberG: 2,
        },
      ],
      macros: {
        calories: 320,
        proteinG: 12,
        carbsG: 10,
        fatsG: 25,
        fiberG: 2,
      },
      confidence: 0.9,
      notes: 'High in fats due to butter/cream. Good protein source.',
      mealFeedback: 'Solid protein at 12 g — about 8% of your daily target.',
      workoutSuggestion: null,
    }
    mockPrimaryInvoke.mockResolvedValue(mockOutput)

    // Start worker
    startMealAnalyzerWorker(mockChannel as unknown as Channel, mockRedis)

    // Capture consume callback
    expect(mockChannel.consume).toHaveBeenCalledWith('meal.analysis.request', expect.any(Function))
    const consumeCallback = mockChannel.consume.mock.calls[0][1]

    // Create a mock RabbitMQ message
    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          correlationId: 'test-corr-id',
          payload: {
            mealId: 'meal-123',
            userId: 'user-456',
            imageUrl: 'http://localhost:3000/uploads/meals/meal.png',
            description: 'Paneer subji',
            mealType: 'lunch',
            isPro: true,
            traceId: 'trace-789',
          },
        }),
      ),
      properties: {
        headers: {},
      },
    } as unknown as ConsumeMessage

    // Invoke consumer callback
    await consumeCallback(mockMsg)

    // Assert fetch was called with the image URL
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/uploads/meals/meal.png',
      expect.any(Object),
    )

    // Assert primary model was called with country-aware system prompt
    expect(mockPrimaryInvoke).toHaveBeenCalled()
    const invokeArgs = mockPrimaryInvoke.mock.calls[0][0] as Array<{ content: string }>
    const systemMessage = invokeArgs[0]
    expect(systemMessage.content).toContain('Country: India (IN)')
    expect(systemMessage.content).toContain('Dietary preference: vegetarian')
    expect(mockFallbackInvoke).not.toHaveBeenCalled()

    // Assert outcome was published
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'fitmind.direct',
      'meal.result',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    )

    const publishedPayload = JSON.parse(mockChannel.publish.mock.calls[0][2].toString()).payload
    expect(publishedPayload.status).toBe('completed')
    expect(publishedPayload.mealId).toBe('meal-123')
    expect(publishedPayload.macros.calories).toBe(320)
    expect(publishedPayload.confidence).toBe(0.9)
    expect(publishedPayload.mealFeedback).toBe(
      'Solid protein at 12 g — about 8% of your daily target.',
    )
    expect(publishedPayload.workoutSuggestion).toBeNull()
    expect(mockRedis.get).toHaveBeenCalledWith('user_context:user-456')

    // Assert message was acked
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg)
  })

  it('falls back to the secondary model if the primary model fails', async () => {
    // Primary fails
    mockPrimaryInvoke.mockRejectedValue(new Error('Rate limit exceeded'))

    // Fallback succeeds
    const mockOutput = {
      foods_detected: [
        {
          name: 'Dal Tadka',
          quantity: '1 bowl',
          calories: 150,
          proteinG: 8,
          carbsG: 22,
          fatsG: 4,
          fiberG: 6,
        },
      ],
      macros: {
        calories: 150,
        proteinG: 8,
        carbsG: 22,
        fatsG: 4,
        fiberG: 6,
      },
      confidence: 0.8,
      notes: 'Lean protein and high fiber.',
      mealFeedback: 'Light meal with good fiber — easy to fit into your cut.',
      workoutSuggestion: null,
    }
    mockFallbackInvoke.mockResolvedValue(mockOutput)

    startMealAnalyzerWorker(mockChannel as unknown as Channel, mockRedis)
    const consumeCallback = mockChannel.consume.mock.calls[0][1]

    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          correlationId: 'test-corr-id',
          payload: {
            mealId: 'meal-456',
            userId: 'user-456',
            imageUrl: null, // text-only test
            description: 'Dal Tadka',
            mealType: 'dinner',
            isPro: false,
            traceId: 'trace-789',
          },
        }),
      ),
      properties: {
        headers: {},
      },
    } as unknown as ConsumeMessage

    await consumeCallback(mockMsg)

    // Debug instrumentation may call fetch; image fetch should not happen for text-only meals
    expect(mockFetch).not.toHaveBeenCalledWith('http://localhost:3000/uploads/meals/meal.png')

    // Assert both models were invoked
    expect(mockPrimaryInvoke).toHaveBeenCalled()
    expect(mockFallbackInvoke).toHaveBeenCalled()

    // Assert outcome was published with completed status
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'fitmind.direct',
      'meal.result',
      expect.any(Buffer),
      expect.any(Object),
    )

    const publishedPayload = JSON.parse(mockChannel.publish.mock.calls[0][2].toString()).payload
    expect(publishedPayload.status).toBe('completed')
    expect(publishedPayload.macros.calories).toBe(150)

    // Assert message was acked
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg)
  })

  it('publishes a failed result when the model returns incomplete macros', async () => {
    mockPrimaryInvoke.mockResolvedValue({
      foods_detected: [],
      macros: null,
      confidence: 0.5,
      notes: 'Incomplete',
    })

    startMealAnalyzerWorker(mockChannel as unknown as Channel, mockRedis)
    const consumeCallback = mockChannel.consume.mock.calls[0][1]

    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          correlationId: 'test-corr-id',
          payload: {
            mealId: 'meal-incomplete',
            userId: 'user-456',
            imageUrl: null,
            description: 'Roti',
            mealType: 'lunch',
            isPro: false,
            traceId: 'trace-789',
          },
        }),
      ),
      properties: { headers: {} },
    } as unknown as ConsumeMessage

    await consumeCallback(mockMsg)

    const publishedPayload = JSON.parse(mockChannel.publish.mock.calls[0][2].toString()).payload
    expect(publishedPayload.status).toBe('failed')
    expect(publishedPayload.errorMessage).toContain('incomplete macro data')
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg)
  })

  it('publishes a failed result and acks when both primary and secondary models fail', async () => {
    mockPrimaryInvoke.mockRejectedValue(new Error('Sonnet failed'))
    mockFallbackInvoke.mockRejectedValue(new Error('Haiku failed'))

    startMealAnalyzerWorker(mockChannel as unknown as Channel, mockRedis)
    const consumeCallback = mockChannel.consume.mock.calls[0][1]

    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          correlationId: 'test-corr-id',
          payload: {
            mealId: 'meal-789',
            userId: 'user-456',
            imageUrl: null,
            description: 'Samosa',
            mealType: 'snack',
            isPro: false,
            traceId: 'trace-789',
          },
        }),
      ),
      properties: {
        headers: {},
      },
    } as unknown as ConsumeMessage

    await consumeCallback(mockMsg)

    expect(mockPrimaryInvoke).toHaveBeenCalled()
    expect(mockFallbackInvoke).toHaveBeenCalled()

    expect(mockChannel.publish).toHaveBeenCalledWith(
      'fitmind.direct',
      'meal.result',
      expect.any(Buffer),
      expect.any(Object),
    )

    const publishedPayload = JSON.parse(mockChannel.publish.mock.calls[0][2].toString()).payload
    expect(publishedPayload.status).toBe('failed')
    expect(publishedPayload.errorMessage).toContain('Haiku failed')

    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg)
    expect(mockChannel.nack).not.toHaveBeenCalled()
  })
})

describe('mealAnalyzerOutputSchema', () => {
  it('accepts workoutSuggestion with surplusCalories', () => {
    const parsed = mealAnalyzerOutputSchema.parse({
      foods_detected: [],
      macros: { calories: 1200, proteinG: 40, carbsG: 150, fatsG: 30, fiberG: 5 },
      confidence: 0.8,
      notes: 'High calorie meal',
      mealFeedback: 'Well above your per-meal share.',
      workoutSuggestion: {
        exerciseName: 'Cycling',
        durationMinutes: 45,
        estimatedCalsBurned: 300,
        surplusCalories: 600,
        rationale: 'Offsets part of the 600 kcal surplus.',
      },
    })
    expect(parsed.workoutSuggestion?.surplusCalories).toBe(600)
  })
})
