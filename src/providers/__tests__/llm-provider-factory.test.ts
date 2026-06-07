import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: vi
    .fn()
    .mockImplementation((opts: unknown) => ({ _provider: 'anthropic', ...(opts as object) })),
}))

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi
    .fn()
    .mockImplementation((opts: unknown) => ({ _provider: 'openai', ...(opts as object) })),
}))

vi.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: vi
    .fn()
    .mockImplementation((opts: unknown) => ({ _provider: 'gemini', ...(opts as object) })),
}))

vi.mock('@langchain/ollama', () => ({
  ChatOllama: vi
    .fn()
    .mockImplementation((opts: unknown) => ({ _provider: 'ollama', ...(opts as object) })),
}))

import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatOllama } from '@langchain/ollama'
import {
  buildPrimaryModel,
  buildFallbackModel,
  resolveStructuredOutputMethod,
} from '../llm-provider.factory.js'

const MockChatAnthropic = vi.mocked(ChatAnthropic)
const MockChatOpenAI = vi.mocked(ChatOpenAI)
const MockChatGoogleGenerativeAI = vi.mocked(ChatGoogleGenerativeAI)
const MockChatOllama = vi.mocked(ChatOllama)

const SAVED_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  // Reset to clean state before each test
  delete process.env.LLM_PRIMARY_PROVIDER
  delete process.env.LLM_FALLBACK_PROVIDER
  delete process.env.LLM_CHAT_MODEL
  delete process.env.LLM_FAST_MODEL
  delete process.env.LLM_VISION_MODEL
  delete process.env.LLM_FALLBACK_CHAT_MODEL
  delete process.env.LLM_FALLBACK_ANTHROPIC_API_KEY
  delete process.env.LLM_FALLBACK_OPENAI_API_KEY
  delete process.env.LLM_FALLBACK_GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.OLLAMA_BASE_URL
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.OPENAI_API_KEY = 'test-openai-key'
})

afterEach(() => {
  process.env = { ...SAVED_ENV }
})

// ── buildPrimaryModel ─────────────────────────────────────────────────────────

describe('buildPrimaryModel', () => {
  it('constructs ChatAnthropic for anthropic provider (default)', () => {
    const model = buildPrimaryModel('chat')
    expect(MockChatAnthropic).toHaveBeenCalledOnce()
    const opts = MockChatAnthropic.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('claude-3-5-sonnet-20241022')
    expect((opts as { apiKey: string }).apiKey).toBe('test-anthropic-key')
    expect(model).toBeDefined()
  })

  it('constructs ChatAnthropic with fast model for task="fast"', () => {
    buildPrimaryModel('fast')
    const opts = MockChatAnthropic.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('claude-haiku-4-5-20251001')
  })

  it('constructs ChatAnthropic with vision model for task="vision"', () => {
    buildPrimaryModel('vision')
    const opts = MockChatAnthropic.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('claude-3-5-sonnet-20241022')
  })

  it('constructs ChatOpenAI when LLM_PRIMARY_PROVIDER=openai', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'openai'
    buildPrimaryModel('chat')
    expect(MockChatOpenAI).toHaveBeenCalledOnce()
    const opts = MockChatOpenAI.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('gpt-4o')
  })

  it('respects LLM_VISION_MODEL env override', () => {
    process.env.LLM_VISION_MODEL = 'claude-opus-custom'
    buildPrimaryModel('vision')
    const opts = MockChatAnthropic.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('claude-opus-custom')
  })

  it('constructs ChatGoogleGenerativeAI when LLM_PRIMARY_PROVIDER=gemini', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'gemini'
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    buildPrimaryModel('chat')
    expect(MockChatGoogleGenerativeAI).toHaveBeenCalledOnce()
    const opts = MockChatGoogleGenerativeAI.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('gemini-2.5-flash')
  })

  it('constructs ChatOllama when LLM_PRIMARY_PROVIDER=ollama', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'ollama'
    const model = buildPrimaryModel('chat')
    expect(MockChatOllama).toHaveBeenCalledOnce()
    const opts = MockChatOllama.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('qwen3.5')
    expect((opts as { baseUrl: string }).baseUrl).toBe('http://127.0.0.1:11434')
    expect((opts as { temperature: number }).temperature).toBe(0.3)
    expect(model).toBeDefined()
  })

  it('respects OLLAMA_BASE_URL env override', () => {
    process.env.LLM_PRIMARY_PROVIDER = 'ollama'
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    buildPrimaryModel('fast')
    const opts = MockChatOllama.mock.calls[0]?.[0]
    expect((opts as { baseUrl: string }).baseUrl).toBe('http://localhost:11434')
  })
})

// ── buildFallbackModel ────────────────────────────────────────────────────────

describe('buildFallbackModel', () => {
  it('returns null when LLM_FALLBACK_PROVIDER is not set', () => {
    const model = buildFallbackModel('chat')
    expect(model).toBeNull()
    expect(MockChatAnthropic).not.toHaveBeenCalled()
    expect(MockChatOpenAI).not.toHaveBeenCalled()
  })

  it('constructs ChatAnthropic when LLM_FALLBACK_PROVIDER=anthropic', () => {
    process.env.LLM_FALLBACK_PROVIDER = 'anthropic'
    process.env.LLM_FALLBACK_ANTHROPIC_API_KEY = 'fallback-key'
    const model = buildFallbackModel('chat')
    expect(model).not.toBeNull()
    expect(MockChatAnthropic).toHaveBeenCalledOnce()
    const opts = MockChatAnthropic.mock.calls[0]?.[0]
    expect((opts as { apiKey: string }).apiKey).toBe('fallback-key')
  })

  it('constructs ChatOpenAI when LLM_FALLBACK_PROVIDER=openai', () => {
    process.env.LLM_FALLBACK_PROVIDER = 'openai'
    process.env.LLM_FALLBACK_OPENAI_API_KEY = 'fallback-openai-key'
    const model = buildFallbackModel('fast')
    expect(model).not.toBeNull()
    expect(MockChatOpenAI).toHaveBeenCalledOnce()
  })

  it('constructs ChatOllama when LLM_FALLBACK_PROVIDER=ollama', () => {
    process.env.LLM_FALLBACK_PROVIDER = 'ollama'
    const model = buildFallbackModel('chat')
    expect(model).not.toBeNull()
    expect(MockChatOllama).toHaveBeenCalledOnce()
    const opts = MockChatOllama.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('qwen3.5')
  })

  it('respects LLM_FALLBACK_CHAT_MODEL env override', () => {
    process.env.LLM_FALLBACK_PROVIDER = 'anthropic'
    process.env.LLM_FALLBACK_ANTHROPIC_API_KEY = 'key'
    process.env.LLM_FALLBACK_CHAT_MODEL = 'claude-haiku-custom'
    buildFallbackModel('chat')
    const opts = MockChatAnthropic.mock.calls[0]?.[0]
    expect((opts as { model: string }).model).toBe('claude-haiku-custom')
  })
})

describe('resolveStructuredOutputMethod', () => {
  it('returns functionCalling for all providers including ollama', () => {
    expect(resolveStructuredOutputMethod('ollama')).toBe('functionCalling')
    expect(resolveStructuredOutputMethod('anthropic')).toBe('functionCalling')
    expect(resolveStructuredOutputMethod('openai')).toBe('functionCalling')
    expect(resolveStructuredOutputMethod('gemini')).toBe('functionCalling')
  })
})
