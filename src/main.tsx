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

// After a new deploy the chunk file names change; a tab left open on the old
// build fails to lazy-load modules ("Failed to load module script"). Reload once
// to fetch the fresh bundle, guarded against reload loops.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'pai_chunk_reloaded_at'
  const last = Number(sessionStorage.getItem(key) || '0')
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(key, String(Date.now()))
    event.preventDefault()
    location.reload()
  }
})

const errorFallback = (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'sans-serif', color: '#334155', textAlign: 'center', lineHeight: 2 }}>
    <div>
      页面出现错误<br />
      <button
        onClick={() => location.reload()}
        style={{ marginTop: 12, padding: '8px 18px', border: '1px solid #C7D2FE', borderRadius: 8, background: '#EEF2FF', color: '#334155', fontSize: 13, cursor: 'pointer' }}
      >
        刷新重试
      </button>
    </div>
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={errorFallback}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
