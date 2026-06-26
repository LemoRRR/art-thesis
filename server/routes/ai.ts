import { Router, type Response } from 'express'
import { callAIStream, type Message } from '../lib/ai.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const AI_STREAM_TIMEOUT_MS = 8 * 60_000
const VALID_ROLES = new Set(['system', 'user', 'assistant'])

function isValidMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return typeof message.role === 'string' &&
    VALID_ROLES.has(message.role) &&
    typeof message.content === 'string' &&
    message.content.trim().length > 0
}

function normalizeMessages(value: unknown): Message[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) return null
  if (!value.every(isValidMessage)) return null
  return value.map(message => ({
    role: message.role,
    content: message.content.slice(0, 30_000),
  }))
}

function writeSseError(res: Response, message: string) {
  if (!res.writableEnded) res.write(`data: [ERROR] ${message}\n\n`)
  if (!res.writableEnded) res.end()
}

router.post('/stream', async (req, res) => {
  const messages = normalizeMessages(req.body?.messages)
  if (!messages) {
    res.status(400).json({ error: 'Invalid AI messages payload' })
    return
  }

  const model = req.body?.model === 'doubao' ? 'doubao' : 'gpt'
  const controller = new AbortController()
  let clientClosed = false
  const timeout = setTimeout(() => controller.abort(), AI_STREAM_TIMEOUT_MS)

  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true
      controller.abort()
    }
  })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const response = await callAIStream(model, messages, controller.signal)
    if (clientClosed) return

    if (!response.ok || !response.body) {
      writeSseError(res, `AI call failed with status ${response.status}`)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientClosed) return

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim().startsWith('data: ') && !res.writableEnded) {
          res.write(`${line}\n\n`)
        }
      }
    }

    if (!res.writableEnded) res.write('data: [DONE]\n\n')
    if (!res.writableEnded) res.end()
  } catch (error) {
    if (clientClosed) return
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'AI request timed out or was cancelled'
      : error instanceof Error ? error.message : String(error)
    writeSseError(res, message)
  } finally {
    clearTimeout(timeout)
  }
})

export default router
