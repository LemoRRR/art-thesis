import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Message, StreamCallbacks } from './ai'

const BASE_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_BASE_URL || '')
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
let browserSupabase: SupabaseClient | null = null
let browserSupabaseConfigKey = ''

export function getToken(): string | null {
  return localStorage.getItem('access_token')
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const token = getToken()
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${path} request timed out. Refresh and try again.`, { cause: error })
    }
    if (error instanceof TypeError) {
      throw new Error('Cannot connect to the online service. Refresh and try again.', { cause: error })
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }))
    if (res.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('auth_user')
    }
    throw new Error(`${path} ${res.status}: ${error.error ?? 'Request failed'}`)
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
  create: (titleOrData: string | unknown, description?: string) =>
    request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(
        typeof titleOrData === 'string'
          ? { title: titleOrData, description }
          : titleOrData
      ),
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

export const outlinesAPI = {
  getByProject: (projectId: string) => request(`/api/outlines/project/${projectId}`),
  saveForProject: (projectId: string, data: unknown) =>
    request(`/api/outlines/project/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  confirm: (projectId: string) =>
    request(`/api/outlines/project/${projectId}/confirm`, { method: 'POST' }),
  clear: (projectId: string) =>
    request(`/api/outlines/project/${projectId}`, { method: 'DELETE' }),
}

export const libraryAPI = {
  list: () => request('/api/library'),
  search: (query: string) => request(`/api/library?search=${encodeURIComponent(query)}`),
  get: (id: string) => request(`/api/library/${id}`),
  create: (data: unknown) =>
    request('/api/library', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request(`/api/library/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request(`/api/library/${id}`, { method: 'DELETE' }),
}

export const styleProfilesAPI = {
  list: () => request('/api/style-profiles'),
  search: (query: string) => request(`/api/style-profiles?search=${encodeURIComponent(query)}`),
  get: (id: string) => request(`/api/style-profiles/${id}`),
  create: (data: unknown) =>
    request('/api/style-profiles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request(`/api/style-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request(`/api/style-profiles/${id}`, { method: 'DELETE' }),
}

export const chatAPI = {
  listByProjectStage: (projectId: string, stage: string) =>
    request(`/api/chat/project/${projectId}/${stage}`),
  saveForProjectStage: (projectId: string, stage: string, messages: unknown[]) =>
    request(`/api/chat/project/${projectId}/${stage}`, {
      method: 'PUT',
      body: JSON.stringify({ messages }),
    }),
}

export const versionsAPI = {
  listByProject: (projectId: string) => request(`/api/versions/project/${projectId}`),
  create: (projectId: string, data: unknown) =>
    request(`/api/versions/project/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

export const referencesAPI = {
  get: (projectId: string, stage: string) =>
    request(`/api/references/project/${projectId}/${stage}`),
  save: (projectId: string, stage: string, data: unknown) =>
    request(`/api/references/project/${projectId}/${stage}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}

type SignedUploadResponse = {
  path: string
  token: string
  signedUrl?: string
  fileName: string
  contentType: string
  fileSize: number
  supabaseUrl?: string
  supabaseAnonKey?: string
}

function getBrowserSupabase(supabaseUrl = SUPABASE_URL, supabaseAnonKey = SUPABASE_ANON_KEY) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase upload settings are missing. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  const configKey = `${supabaseUrl}:${supabaseAnonKey}`
  if (!browserSupabase || browserSupabaseConfigKey !== configKey) {
    browserSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    browserSupabaseConfigKey = configKey
  }
  return browserSupabase
}

export const filesAPI = {
  upload: async (file: File) => {
    const token = getToken()
    if (!token) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('auth_user')
      throw new Error('Please log in before uploading files.')
    }

    const contentType = file.type || 'application/octet-stream'
    try {
      const signed = await request<SignedUploadResponse>('/api/files/signed-upload', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          contentType,
          fileSize: file.size,
        }),
      })

      const { error: uploadError } = await getBrowserSupabase(signed.supabaseUrl, signed.supabaseAnonKey)
        .storage
        .from('library-files')
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType })

      if (uploadError) {
        throw new Error(`File upload failed: ${uploadError.message}`)
      }

      return request('/api/files/import-uploaded', {
        method: 'POST',
        body: JSON.stringify({
          path: signed.path,
          fileName: signed.fileName || file.name,
          contentType,
          fileSize: file.size,
        }),
      }, 120_000)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Supabase upload settings are missing')) {
        throw error
      }
    }

    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE_URL}/api/files/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({
        error: res.status === 413
          ? 'File upload is too large for the API gateway. Direct upload settings are missing.'
          : 'File upload failed',
      }))
      if (res.status === 401) {
        localStorage.removeItem('access_token')
        localStorage.removeItem('auth_user')
      }
      throw new Error(error.error ?? `File upload failed (HTTP ${res.status})`)
    }
    return res.json()
  },
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
      callbacks.onError(new Error('AI request failed'))
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
          // Ignore malformed SSE chunks.
        }
      }
    }

    callbacks.onDone()
  }).catch(error => {
    if (error.name !== 'AbortError') callbacks.onError(error)
  })
}
