// Frontend AI calls always go through our own backend proxy, so model keys are not exposed.
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
const STREAM_STALL_TIMEOUT_MS = 90_000
const STREAM_TOTAL_TIMEOUT_MS = 8 * 60_000

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
  const controller = new AbortController()
  let timedOut: 'stall' | 'total' | null = null
  let settled = false
  let stallTimer: number | undefined

  const cleanup = () => {
    settled = true
    window.clearTimeout(stallTimer)
    window.clearTimeout(totalTimer)
    signal?.removeEventListener('abort', handleExternalAbort)
  }

  const fail = (error: Error) => {
    if (settled) return
    cleanup()
    callbacks.onError(error)
  }

  const done = () => {
    if (settled) return
    cleanup()
    callbacks.onDone()
  }

  const resetStallTimer = () => {
    window.clearTimeout(stallTimer)
    stallTimer = window.setTimeout(() => {
      timedOut = 'stall'
      controller.abort()
    }, STREAM_STALL_TIMEOUT_MS)
  }

  const handleExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', handleExternalAbort, { once: true })

  const totalTimer = window.setTimeout(() => {
    timedOut = 'total'
    controller.abort()
  }, STREAM_TOTAL_TIMEOUT_MS)

  resetStallTimer()

  fetch(`${BASE_URL}/api/ai/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, model }),
    signal: controller.signal,
  }).then(async res => {
    resetStallTimer()
    if (!res.ok || !res.body) {
      if (res.status === 401) {
        localStorage.removeItem('access_token')
        localStorage.removeItem('auth_user')
        fail(new Error('登录已过期，请重新登录后再试。'))
        return
      }
      const detail = await res.text().catch(() => '')
      fail(new Error(detail || 'AI 调用失败，请稍后再试。'))
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done: streamDone, value } = await reader.read()
      resetStallTimer()
      if (streamDone) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          done()
          return
        }
        if (data.startsWith('[ERROR]')) {
          fail(new Error(data.replace('[ERROR]', '').trim() || 'AI 调用失败'))
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

    done()
  }).catch(error => {
    if (error instanceof Error && error.name === 'AbortError') {
      if (timedOut === 'stall') {
        fail(new Error('AI 生成超过 90 秒没有新内容，已自动停止。请稍后重试或单独生成当前章节。'))
      } else if (timedOut === 'total') {
        fail(new Error('AI 生成时间超过 8 分钟，已自动停止。建议拆分章节后重试。'))
      } else {
        cleanup()
      }
      return
    }
    fail(error instanceof Error ? error : new Error(String(error)))
  })
}

// GPT: material understanding, new content generation, style extraction.
export function callGPT(
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  return streamViaServer('gpt', messages, callbacks, signal)
}

// Doubao: paragraph revision, selection rewrite, shorten, expand, academicize.
export function callDoubao(
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  return streamViaServer('doubao', messages, callbacks, signal)
}
