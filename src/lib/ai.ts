// AI 调用核心文件：前端只请求自己的后端代理，不暴露模型密钥。
export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (err: Error) => void
}

const BASE_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_BASE_URL || '')

function getToken(): string | null {
  return localStorage.getItem('access_token')
}

function streamViaServer(
  model: 'gpt' | 'doubao',
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  const token = getToken()
  fetch(`${BASE_URL}/api/ai/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, model }),
    signal,
  }).then(async res => {
    if (!res.ok || !res.body) {
      if (res.status === 401) {
        localStorage.removeItem('access_token')
        localStorage.removeItem('auth_user')
        callbacks.onError(new Error('登录已过期，请重新登录后再试。'))
        return
      }
      const detail = await res.text().catch(() => '')
      callbacks.onError(new Error(detail || 'AI 调用失败，请稍后再试。'))
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          callbacks.onDone()
          return
        }
        if (data.startsWith('[ERROR]')) {
          callbacks.onError(new Error(data.replace('[ERROR]', '').trim() || 'AI 调用失败'))
          return
        }
        try {
          const json = JSON.parse(data)
          const text = json.choices?.[0]?.delta?.content
          if (text) callbacks.onChunk(text)
        } catch {
          // Ignore malformed SSE chunks.
        }
      }
    }

    callbacks.onDone()
  }).catch(error => {
    if (error instanceof Error && error.name === 'AbortError') return
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
  })
}

// GPT：用于材料理解、写新内容、语言风格提取。
export function callGPT(
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  return streamViaServer('gpt', messages, callbacks, signal)
}

// 豆包：用于段落修改、框选改写、缩短、扩写、学术化。
export function callDoubao(
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  return streamViaServer('doubao', messages, callbacks, signal)
}
