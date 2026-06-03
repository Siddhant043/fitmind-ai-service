import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Channel, ConsumeMessage } from 'amqplib'
import { startTdeeWorker } from '../tdee.worker.js'

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
}))

const mockTdeeOutput = {
  calories: 2400,
  protein_g: 180,
  carbs_g: 280,
  fats_g: 70,
  fiber_g: 35,
  reasoning: 'Moderate surplus for lean muscle gain based on activity level.',
}

const mockRequest = {
  requestId: 'req-123',
  userId: 'user-456',
  sex: 'male',
  weightKg: 80,
  heightCm: 178,
  ageYears: 28,
  activityLevel: 'moderate',
  goal: 'bulk',
  dietaryPref: 'vegetarian',
}

function makeMsg(payload: object, retryCount = 0): ConsumeMessage {
  return {
    content: Buffer.from(
      JSON.stringify({
        correlationId: 'corr-abc',
        payload,
        metadata: { traceId: 'trace-xyz' },
      }),
    ),
    properties: { headers: retryCount > 0 ? { 'x-retry-count': retryCount } : {} },
  } as unknown as ConsumeMessage
}

describe('TDEE Calculation Worker', () => {
  let mockChannel: ReturnType<typeof buildMockChannel>

  function buildMockChannel() {
    return {
      prefetch: vi.fn(),
      consume: vi.fn(),
      ack: vi.fn(),
      nack: vi.fn(),
      publish: vi.fn(),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockChannel = buildMockChannel()
  })

  it('publishes a completed result and acks on successful LLM call', async () => {
    mockPrimaryInvoke.mockResolvedValue(mockTdeeOutput)

    startTdeeWorker(mockChannel as unknown as Channel)

    expect(mockChannel.consume).toHaveBeenCalledWith(
      'tdee.calculation.request',
      expect.any(Function),
    )
    const callback = mockChannel.consume.mock.calls[0][1]
    await callback(makeMsg(mockRequest))

    expect(mockPrimaryInvoke).toHaveBeenCalledOnce()
    expect(mockFallbackInvoke).not.toHaveBeenCalled()

    expect(mockChannel.publish).toHaveBeenCalledWith(
      'fitmind.direct',
      'tdee.result',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    )

    const published = JSON.parse(mockChannel.publish.mock.calls[0][2].toString())
    expect(published.payload.status).toBe('completed')
    expect(published.payload.result.calories).toBe(2400)
    expect(published.payload.result.protein_g).toBe(180)
    expect(published.payload.requestId).toBe('req-123')

    expect(mockChannel.ack).toHaveBeenCalledOnce()
    expect(mockChannel.nack).not.toHaveBeenCalled()
  })

  it('falls back to secondary model and publishes completed result when primary fails', async () => {
    mockPrimaryInvoke.mockRejectedValue(new Error('Rate limit exceeded'))
    mockFallbackInvoke.mockResolvedValue({ ...mockTdeeOutput, calories: 2200 })

    startTdeeWorker(mockChannel as unknown as Channel)
    const callback = mockChannel.consume.mock.calls[0][1]
    await callback(makeMsg(mockRequest))

    expect(mockPrimaryInvoke).toHaveBeenCalledOnce()
    expect(mockFallbackInvoke).toHaveBeenCalledOnce()

    const published = JSON.parse(mockChannel.publish.mock.calls[0][2].toString())
    expect(published.payload.status).toBe('completed')
    expect(published.payload.result.calories).toBe(2200)

    expect(mockChannel.ack).toHaveBeenCalledOnce()
  })

  it('nacks without requeue when retry count < 3 and both models fail', async () => {
    mockPrimaryInvoke.mockRejectedValue(new Error('Primary failed'))
    mockFallbackInvoke.mockRejectedValue(new Error('Fallback failed'))

    startTdeeWorker(mockChannel as unknown as Channel)
    const callback = mockChannel.consume.mock.calls[0][1]
    await callback(makeMsg(mockRequest, 1))

    expect(mockChannel.publish).not.toHaveBeenCalled()
    expect(mockChannel.ack).not.toHaveBeenCalled()
    expect(mockChannel.nack).toHaveBeenCalledWith(expect.anything(), false, false)
  })

  it('publishes failed result and nacks when retries are exhausted (x-retry-count >= 3)', async () => {
    mockPrimaryInvoke.mockRejectedValue(new Error('Primary failed'))
    mockFallbackInvoke.mockRejectedValue(new Error('Fallback failed'))

    startTdeeWorker(mockChannel as unknown as Channel)
    const callback = mockChannel.consume.mock.calls[0][1]
    await callback(makeMsg(mockRequest, 3))

    expect(mockChannel.publish).toHaveBeenCalledOnce()
    const published = JSON.parse(mockChannel.publish.mock.calls[0][2].toString())
    expect(published.payload.status).toBe('failed')
    expect(published.payload.errorMessage).toContain('Fallback failed')

    expect(mockChannel.nack).toHaveBeenCalledWith(expect.anything(), false, false)
    expect(mockChannel.ack).not.toHaveBeenCalled()
  })

  it('nacks without requeue on malformed message JSON', async () => {
    startTdeeWorker(mockChannel as unknown as Channel)
    const callback = mockChannel.consume.mock.calls[0][1]

    const badMsg = {
      content: Buffer.from('not valid json'),
      properties: { headers: {} },
    } as unknown as ConsumeMessage

    await callback(badMsg)

    expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false)
    expect(mockPrimaryInvoke).not.toHaveBeenCalled()
  })
})
