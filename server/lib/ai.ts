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

export async function callAIStream(
  provider: 'gpt' | 'doubao',
  messages: Message[]
) {
  const config = getAIConfig(provider)
  if (!config.baseURL || !config.apiKey || !config.model) {
    throw new Error(`${provider} AI 环境变量未配置完整`)
  }

  return fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      max_tokens: 4000,
      temperature: 0.7,
    }),
  })
}

export async function callAIOnce(
  messages: Message[],
  provider: 'gpt' | 'doubao' = 'gpt'
): Promise<string> {
  const config = getAIConfig(provider)
  if (!config.baseURL || !config.apiKey || !config.model) {
    throw new Error(`${provider} AI 环境变量未配置完整`)
  }

  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      max_tokens: 2200,
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`AI 调用失败 ${response.status}: ${detail}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content ?? ''
}
