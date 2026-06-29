import './instrument.js'
import * as Sentry from '@sentry/node'
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
import researchPackagesRouter from './routes/researchPackages.js'
import researchRouter from './routes/research.js'
import scholarRouter from './routes/scholar.js'
import sectionsRouter from './routes/sections.js'
import styleProfilesRouter from './routes/styleProfiles.js'
import versionsRouter from './routes/versions.js'

const app = express()
const PORT = process.env.PORT || 3001
const allowedOrigins = new Set([
  process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
])

function isAllowedDevOrigin(origin: string) {
  return process.env.NODE_ENV !== 'production' && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/i.test(origin)
}

app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || isAllowedDevOrigin(origin) || origin.endsWith('.vercel.app')) {
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

app.use('/api/scholar', scholarRouter)
app.use('/api/auth', authRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/outlines', outlinesRouter)
app.use('/api/sections', sectionsRouter)
app.use('/api/versions', versionsRouter)
app.use('/api/library', libraryRouter)
app.use('/api/style-profiles', styleProfilesRouter)
app.use('/api/chat', chatRouter)
app.use('/api/references', referencesRouter)
app.use('/api/research-packages', researchPackagesRouter)
app.use('/api/research', researchRouter)
app.use('/api/ai', aiRouter)
app.use('/api/files', filesRouter)

// Capture unhandled route errors in Sentry (no-op unless SENTRY_DSN is set).
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app)
}

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`后端运行在 http://localhost:${PORT}`)
  })
}

export default app
