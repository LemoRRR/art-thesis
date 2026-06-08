import { Router } from 'express'
import { callAIStream } from '../lib/ai'
import { requireAuth } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.post('/stream', async (req, res) => {
  const { messages, model = 'gpt' } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const response = await callAIStream(model === 'doubao' ? 'doubao' : 'gpt', messages)
    if (!response.ok || !response.body) {
      res.write('data: [ERROR] AI 调用失败\n\n')
      res.end()
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim().startsWith('data: ')) {
          res.write(`${line}\n\n`)
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error) {
    res.write(`data: [ERROR] ${error instanceof Error ? error.message : String(error)}\n\n`)
    res.end()
  }
})

export default router
