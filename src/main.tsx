import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'

// Inert unless VITE_SENTRY_DSN is set at build time.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: 24, fontFamily: 'sans-serif' }}>页面出现错误，请刷新后重试。</div>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
