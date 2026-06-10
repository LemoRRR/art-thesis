import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import aiRouter from './routes/ai.js'
import authRouter from './routes/auth.js'
import chatRouter from './routes/chat.js'
import filesRouter from './routes/files.js'
import libraryRouter from './routes/library.js'
import outlinesRouter from './routes/outlines.js'
import projectsRouter from './routes/projects.js'
import referencesRouter from './routes/references.js'
import sectionsRouter from './routes/sections.js'
import versionsRouter from './routes/versions.js'

const app = express()
const PORT = process.env.PORT || 3001
const allowedOrigins = new Set([
  process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true)
      return
    }
    callback(new Error(`CORS origin not allowed: ${origin}`))
  },
}))
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'paper-ai-tool-api' })
})

app.use('/api/auth', authRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/outlines', outlinesRouter)
app.use('/api/sections', sectionsRouter)
app.use('/api/versions', versionsRouter)
app.use('/api/library', libraryRouter)
app.use('/api/chat', chatRouter)
app.use('/api/references', referencesRouter)
app.use('/api/ai', aiRouter)
app.use('/api/files', filesRouter)

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`后端运行在 http://localhost:${PORT}`)
  })
}

export default app
