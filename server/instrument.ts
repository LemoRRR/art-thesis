// Sentry initialization for the backend. Imported FIRST in server/index.ts so
// it runs before any request handling. Completely inert unless SENTRY_DSN is set,
// so local/dev and unconfigured environments are unaffected.
import * as Sentry from '@sentry/node'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    // Errors only by default; enable tracing later if needed.
    tracesSampleRate: 0,
  })
}

export const sentryEnabled = Boolean(dsn)
