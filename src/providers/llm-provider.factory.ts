import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

export type LlmTask = 'chat' | 'fast' | 'vision'
type Provider = 'anthropic' | 'openai' | 'gemini' | 'ollama'

const DEFAULT_MODELS: Record<Provider, Record<LlmTask, string>> = {
  anthropic: {
    chat: 'claude-3-5-sonnet-20241022',
    fast: 'claude-haiku-4-5-20251001',
    vision: 'claude-3-5-sonnet-20241022',
  },
  openai: {
    chat: 'gpt-4o',
    fast: 'gpt-4o-mini',
    vision: 'gpt-4o',
  },
  gemini: {
    chat: 'gemini-2.0-flash',
    fast: 'gemini-1.5-flash',
    vision: 'gemini-2.0-flash',
  },
  ollama: {
    chat: 'llama3.2',
    fast: 'llama3.2',
    vision: 'llava',
  },
}

const TASK_MODEL_ENV: Record<LlmTask, string> = {
  chat: 'LLM_CHAT_MODEL',
  fast: 'LLM_FAST_MODEL',
  vision: 'LLM_VISION_MODEL',
}

const FALLBACK_TASK_MODEL_ENV: Record<LlmTask, string> = {
  chat: 'LLM_FALLBACK_CHAT_MODEL',
  fast: 'LLM_FALLBACK_FAST_MODEL',
  vision: 'LLM_FALLBACK_VISION_MODEL',
}

function resolveModelName(provider: Provider, task: LlmTask, isFallback: boolean): string {
  const envKey = isFallback ? FALLBACK_TASK_MODEL_ENV[task] : TASK_MODEL_ENV[task]
  return process.env[envKey] ?? DEFAULT_MODELS[provider][task]
}

function buildAnthropicModel(task: LlmTask, isFallback: boolean): BaseChatModel {
  const model = resolveModelName('anthropic', task, isFallback)
  const apiKey = process.env[isFallback ? 'LLM_FALLBACK_ANTHROPIC_API_KEY' : 'ANTHROPIC_API_KEY']
  return new ChatAnthropic({ model, apiKey }) as unknown as BaseChatModel
}

function buildOpenAIModel(task: LlmTask, isFallback: boolean): BaseChatModel {
  const model = resolveModelName('openai', task, isFallback)
  const apiKey = process.env[isFallback ? 'LLM_FALLBACK_OPENAI_API_KEY' : 'OPENAI_API_KEY']
  return new ChatOpenAI({ model, apiKey }) as unknown as BaseChatModel
}

function buildGeminiModel(task: LlmTask, isFallback: boolean): BaseChatModel {
  const model = resolveModelName('gemini', task, isFallback)
  const apiKey = process.env[isFallback ? 'LLM_FALLBACK_GEMINI_API_KEY' : 'GEMINI_API_KEY']
  return new ChatGoogleGenerativeAI({ model, apiKey }) as unknown as BaseChatModel
}

function buildProviderModel(provider: Provider, task: LlmTask, isFallback: boolean): BaseChatModel {
  switch (provider) {
    case 'anthropic':
      return buildAnthropicModel(task, isFallback)
    case 'openai':
      return buildOpenAIModel(task, isFallback)
    case 'gemini':
      return buildGeminiModel(task, isFallback)
    case 'ollama':
      throw new Error(
        'Ollama provider requires @langchain/ollama. Install it and add a buildOllamaModel implementation.',
      )
    default:
      throw new Error(`Unknown LLM provider: ${provider as string}`)
  }
}

export function buildPrimaryModel(task: LlmTask): BaseChatModel {
  const provider = (process.env.LLM_PRIMARY_PROVIDER ?? 'anthropic') as Provider
  return buildProviderModel(provider, task, false)
}

export function buildFallbackModel(task: LlmTask): BaseChatModel | null {
  const provider = process.env.LLM_FALLBACK_PROVIDER as Provider | undefined
  if (!provider) return null
  try {
    return buildProviderModel(provider, task, true)
  } catch {
    return null
  }
}
