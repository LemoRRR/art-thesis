// AI 调用核心文件
// GPT：材料理解、写新内容
// 豆包：段落修改、框选改写

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (err: Error) => void
}

async function streamChat(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 4000,
        temperature: 0.7,
      }),
      signal,
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`API 错误 ${res.status}: ${errText}`)
    }

    if (!res.body) throw new Error('响应体为空')

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
        if (data === '[DONE]') { callbacks.onDone(); return }
        try {
          const json = JSON.parse(data)
          const text = json.choices?.[0]?.delta?.content
          if (text) callbacks.onChunk(text)
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    callbacks.onDone()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return
    callbacks.onError(err instanceof Error ? err : new Error(String(err)))
  }
}

// GPT：用于材料理解、写新内容、语言风格提取
export function callGPT(
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  return streamChat(
    import.meta.env.VITE_OPENAI_BASE_URL,
    import.meta.env.VITE_OPENAI_API_KEY,
    import.meta.env.VITE_OPENAI_MODEL,
    messages,
    callbacks,
    signal
  )
}

// 豆包：用于段落修改、框选改写/缩短/扩写/学术化
export function callDoubao(
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  return streamChat(
    import.meta.env.VITE_DOUBAO_BASE_URL,
    import.meta.env.VITE_DOUBAO_API_KEY,
    import.meta.env.VITE_DOUBAO_MODEL,
    messages,
    callbacks,
    signal
  )
}
