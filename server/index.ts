import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import aiRouter from './routes/ai'
import authRouter from './routes/auth'
import chatRouter from './routes/chat'
import filesRouter from './routes/files'
import libraryRouter from './routes/library'
import outlinesRouter from './routes/outlines'
import projectsRouter from './routes/projects'
import referencesRouter from './routes/references'
import sectionsRouter from './routes/sections'
import versionsRouter from './routes/versions'

const app = express()
const PORT = process.env.PORT || 3001

app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }))
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
