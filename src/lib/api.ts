import type { Message, StreamCallbacks } from './ai'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

export function getToken(): string | null {
  return localStorage.getItem('access_token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: '请求失败' }))
    throw new Error(error.error ?? '请求失败')
  }

  return res.json()
}

export const authAPI = {
  register: (email: string, password: string, displayName?: string) =>
    request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),
  login: (email: string, password: string) =>
    request<{ user: unknown; session: { access_token: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
}

export const projectsAPI = {
  list: () => request('/api/projects'),
  get: (id: string) => request(`/api/projects/${id}`),
  create: (title: string, description?: string) =>
    request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    }),
  update: (id: string, data: unknown) =>
    request(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request(`/api/projects/${id}`, { method: 'DELETE' }),
}

export const sectionsAPI = {
  listByProject: (projectId: string) => request(`/api/sections/project/${projectId}`),
  create: (data: unknown) =>
    request('/api/sections', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request(`/api/sections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  saveAll: (projectId: string, sections: unknown[]) =>
    request(`/api/sections/project/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ sections }),
    }),
  delete: (id: string) => request(`/api/sections/${id}`, { method: 'DELETE' }),
}

export function callAIStream(
  messages: Message[],
  model: 'gpt' | 'doubao',
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
      callbacks.onError(new Error('AI 调用失败'))
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
          callbacks.onError(new Error(data))
          return
        }
        try {
          const json = JSON.parse(data)
          const text = json.choices?.[0]?.delta?.content
          if (text) callbacks.onChunk(text)
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }

    callbacks.onDone()
  }).catch(error => {
    if (error.name !== 'AbortError') callbacks.onError(error)
  })
}
