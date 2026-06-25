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

export function getAIConfig(provider: 'gpt' | 'doubao'): AIConfig {
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

function fallbackConfig(provider: 'gpt' | 'doubao') {
  const primary = getAIConfig(provider)
  if (isConfigReady(primary)) return { provider, config: primary }

  if (provider === 'doubao') {
    const gpt = getAIConfig('gpt')
    if (isConfigReady(gpt)) return { provider: 'gpt' as const, config: gpt }
  }

  throw new Error(`${provider} AI 环境变量未配置完整`)
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
  provider: 'gpt' | 'doubao',
  messages: Message[],
  signal?: AbortSignal
) {
  const resolved = fallbackConfig(provider)
  const response = await requestChatCompletions(resolved.config, messages, true, 4000, 0.7, signal)
  if (response.ok || provider !== 'doubao' || resolved.provider === 'gpt') {
    return response
  }

  const gpt = getAIConfig('gpt')
  if (!isConfigReady(gpt)) return response
  return requestChatCompletions(gpt, messages, true, 4000, 0.7, signal)
}

export async function callAIOnce(
  messages: Message[],
  provider: 'gpt' | 'doubao' = 'gpt'
): Promise<string> {
  const { config } = fallbackConfig(provider)
  const response = await requestChatCompletions(config, messages, false, 2200, 0.3)

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`AI 调用失败 ${response.status}: ${detail}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}
