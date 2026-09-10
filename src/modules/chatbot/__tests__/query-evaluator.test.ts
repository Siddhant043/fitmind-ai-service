import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockPrimaryInvoke, mockFallbackInvoke, buildPrimaryModel, buildFallbackModel } = vi.hoisted(
  () => ({
    mockPrimaryInvoke: vi.fn(),
    mockFallbackInvoke: vi.fn(),
    buildPrimaryModel: vi.fn(),
    buildFallbackModel: vi.fn(),
  }),
)

vi.mock('../../../providers/llm-provider.factory.js', () => ({
  buildPrimaryModel,
  buildFallbackModel,
  resolveStructuredOutputMethod: vi.fn().mockReturnValue('functionCalling'),
}))

import { evaluateQuery } from '../query-evaluator.js'

function buildMockModel(invokeFn: ReturnType<typeof vi.fn>) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeFn }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  buildPrimaryModel.mockReturnValue(buildMockModel(mockPrimaryInvoke))
  buildFallbackModel.mockReturnValue(null)
  mockPrimaryInvoke.mockResolvedValue({
    intent: 'general',
    needsUserData: false,
    complexity: 'deep',
    isMultiHop: false,
  })
})

describe('evaluateQuery', () => {
  it('returns the structured evaluation from the primary model', async () => {
    mockPrimaryInvoke.mockResolvedValue({
      intent: 'fitness_rag',
      needsUserData: false,
      complexity: 'fast',
      isMultiHop: false,
    })

    const result = await evaluateQuery('What is progressive overload?')

    expect(result).toEqual({
      intent: 'fitness_rag',
      needsUserData: false,
      complexity: 'fast',
      isMultiHop: false,
    })
  })

  it('requests the fast model tier for evaluation', async () => {
    await evaluateQuery('How many calories in an egg?')
    expect(buildPrimaryModel).toHaveBeenCalledWith('fast')
  })

  it('marks needsUserData true for a workout_history question', async () => {
    mockPrimaryInvoke.mockResolvedValue({
      intent: 'workout_history',
      needsUserData: true,
      complexity: 'deep',
      isMultiHop: false,
    })

    const result = await evaluateQuery('How was my last workout?')
    expect(result.intent).toBe('workout_history')
    expect(result.needsUserData).toBe(true)
  })

  it('marks isMultiHop true for a bundled fitness_rag question', async () => {
    mockPrimaryInvoke.mockResolvedValue({
      intent: 'fitness_rag',
      needsUserData: false,
      complexity: 'deep',
      isMultiHop: true,
    })

    const result = await evaluateQuery(
      'Compare linear vs undulating periodization, and which is better for hypertrophy?',
    )
    expect(result.isMultiHop).toBe(true)
  })

  it('falls back to the fallback model when the primary model throws', async () => {
    mockPrimaryInvoke.mockRejectedValue(new Error('malformed request'))
    buildFallbackModel.mockReturnValue(buildMockModel(mockFallbackInvoke))
    mockFallbackInvoke.mockResolvedValue({
      intent: 'nutrition_rag',
      needsUserData: false,
      complexity: 'fast',
      isMultiHop: false,
    })

    const result = await evaluateQuery('How much protein do I need?')

    expect(result.intent).toBe('nutrition_rag')
    expect(mockFallbackInvoke).toHaveBeenCalled()
  })

  it('throws when the primary model fails and there is no fallback', async () => {
    mockPrimaryInvoke.mockRejectedValue(new Error('malformed request'))
    buildFallbackModel.mockReturnValue(null)

    await expect(evaluateQuery('How much protein do I need?')).rejects.toThrow()
  })

  it('returns a safe default when the model output fails schema validation', async () => {
    mockPrimaryInvoke.mockResolvedValue({ intent: 'not_a_real_intent' })

    const result = await evaluateQuery('Some ambiguous message')

    expect(result).toEqual({
      intent: 'general',
      needsUserData: false,
      complexity: 'deep',
      isMultiHop: false,
    })
  })
})
