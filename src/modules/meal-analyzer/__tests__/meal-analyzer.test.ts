import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Channel, ConsumeMessage } from 'amqplib'
import { startMealAnalyzerWorker } from '../meal-analyzer.worker.js'

const mockPrimaryInvoke = vi.fn()
const mockFallbackInvoke = vi.fn()

vi.mock('../../../providers/llm-provider.factory.js', () => ({
  buildPrimaryModel: vi.fn().mockReturnValue({
    withStructuredOutput: vi
      .fn()
      .mockReturnValue({ invoke: async (...args: any[]) => mockPrimaryInvoke(...args) }),
  }),
  buildFallbackModel: vi.fn().mockReturnValue({
    withStructuredOutput: vi
      .fn()
      .mockReturnValue({ invoke: async (...args: any[]) => mockFallbackInvoke(...args) }),
  }),
}))

describe('Meal Analyzer AI Worker Unit Tests', () => {
  let mockChannel: any
  let mockFetch: any
  let originalFetch: typeof fetch

  beforeEach(() => {
    vi.clearAllMocks()

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
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('fake-image-bytes'),
      headers: {
        get: (name: string) => (name === 'content-type' ? 'image/png' : null),
      },
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
    }
    mockPrimaryInvoke.mockResolvedValue(mockOutput)

    // Start worker
    startMealAnalyzerWorker(mockChannel as unknown as Channel)

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
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/uploads/meals/meal.png')

    // Assert primary model was called
    expect(mockPrimaryInvoke).toHaveBeenCalled()
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
    }
    mockFallbackInvoke.mockResolvedValue(mockOutput)

    startMealAnalyzerWorker(mockChannel as unknown as Channel)
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

    // Assert fetch was not called since imageUrl is null
    expect(mockFetch).not.toHaveBeenCalled()

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

  it('publishes a failed result and nacks if both primary and secondary models fail and retries are exhausted', async () => {
    mockPrimaryInvoke.mockRejectedValue(new Error('Sonnet failed'))
    mockFallbackInvoke.mockRejectedValue(new Error('Haiku failed'))

    startMealAnalyzerWorker(mockChannel as unknown as Channel)
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
        headers: {
          'x-retry-count': 3, // exhausted
        },
      },
    } as unknown as ConsumeMessage

    await consumeCallback(mockMsg)

    // Assert both were invoked
    expect(mockPrimaryInvoke).toHaveBeenCalled()
    expect(mockFallbackInvoke).toHaveBeenCalled()

    // Assert failure was published
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'fitmind.direct',
      'meal.result',
      expect.any(Buffer),
      expect.any(Object),
    )

    const publishedPayload = JSON.parse(mockChannel.publish.mock.calls[0][2].toString()).payload
    expect(publishedPayload.status).toBe('failed')
    expect(publishedPayload.errorMessage).toContain('Haiku failed')

    // Assert nacked with requeue=false
    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false)
  })
})
