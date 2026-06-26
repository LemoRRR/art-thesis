import './env.js'

interface AIConfig {
  baseURL: string
  apiKey: string
  model: string
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type Provider = 'gpt' | 'doubao'

export function getAIConfig(provider: Provider): AIConfig {
  if (provider === 'doubao') {
    return {
      baseURL: process.env.DOUBAO_BASE_URL ?? '',
      apiKey: process.env.DOUBAO_API_KEY ?? '',
      model: process.env.DOUBAO_MODEL ?? '',
    }
  }

  return {
    baseURL: process.env.OPENAI_BASE_URL ?? '',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? '',
  }
}

function isConfigReady(config: AIConfig) {
  return Boolean(config.baseURL && config.apiKey && config.model)
}

function alternateProvider(provider: Provider): Provider {
  return provider === 'gpt' ? 'doubao' : 'gpt'
}

function resolveConfig(provider: Provider) {
  const primary = getAIConfig(provider)
  if (isConfigReady(primary)) return { provider, config: primary }

  const alternate = alternateProvider(provider)
  const fallback = getAIConfig(alternate)
  if (isConfigReady(fallback)) return { provider: alternate, config: fallback }

  throw new Error(`${provider} AI environment variables are incomplete.`)
}

function getFallbackConfig(provider: Provider) {
  const alternate = alternateProvider(provider)
  const config = getAIConfig(alternate)
  return isConfigReady(config) ? { provider: alternate, config } : null
}

async function requestChatCompletions(
  config: AIConfig,
  messages: Message[],
  stream: boolean,
  maxTokens: number,
  temperature: number,
  signal?: AbortSignal
) {
  return fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream,
      max_tokens: maxTokens,
      temperature,
    }),
    signal,
  })
}

export async function callAIStream(
  provider: Provider,
  messages: Message[],
  signal?: AbortSignal
) {
  const resolved = resolveConfig(provider)
  const response = await requestChatCompletions(resolved.config, messages, true, 4000, 0.7, signal)
  if (response.ok) return response

  const fallback = getFallbackConfig(resolved.provider)
  if (!fallback) return response
  return requestChatCompletions(fallback.config, messages, true, 4000, 0.7, signal)
}

export async function callAIOnce(
  messages: Message[],
  provider: Provider = 'gpt',
  maxTokens = 2200
): Promise<string> {
  const resolved = resolveConfig(provider)
  let response = await requestChatCompletions(resolved.config, messages, false, maxTokens, 0.3)
  let primaryDetail = ''

  if (!response.ok) {
    primaryDetail = await response.text().catch(() => '')
    const fallback = getFallbackConfig(resolved.provider)
    if (fallback) {
      response = await requestChatCompletions(fallback.config, messages, false, maxTokens, 0.3)
    }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`AI call failed ${response.status}: ${detail || primaryDetail}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}
