import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// server/lib/env.ts intentionally loads .env.server with override: true, and
// the project-local API port is defined there. Keep the smoke aligned with the
// real local app shape instead of trying to override PORT from the parent env.
const apiPort = Number(process.env.LOCAL_STAGE3_E2E_API_PORT || process.env.PORT || 3001)
const requestedWebPort = Number(process.env.LOCAL_STAGE3_E2E_WEB_PORT || 5181)

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isPortOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(800, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForUrl(url, label, timeoutMs = 45_000) {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `${response.status} ${response.statusText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await wait(750)
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`)
}

async function isHealthy(url) {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 30; port += 1) {
    if (!(await isPortOpen(port))) return port
  }
  throw new Error(`Could not find a free web port near ${startPort}`)
}

function runProcess(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', data => process.stdout.write(`[${args[0] ?? command}] ${data}`))
  child.stderr.on('data', data => process.stderr.write(`[${args[0] ?? command}] ${data}`))
  return child
}

function stop(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
}

async function main() {
  const apiUrl = `http://127.0.0.1:${apiPort}/api/health`
  const apiAlreadyRunning = await isPortOpen(apiPort)
  let webPort = requestedWebPort
  let baseUrl = `http://127.0.0.1:${webPort}`
  let webAlreadyRunning = await isPortOpen(webPort)
  if (webAlreadyRunning && !(await isHealthy(`${baseUrl}/api/health`))) {
    webPort = await findFreePort(requestedWebPort + 1)
    baseUrl = `http://127.0.0.1:${webPort}`
    webAlreadyRunning = false
  }

  const api = apiAlreadyRunning ? null : runProcess('npx', ['tsx', 'server/index.ts'], {
    NODE_ENV: 'development',
    PORT: String(apiPort),
    AUTH_TIMEOUT_MS: process.env.AUTH_TIMEOUT_MS || '2500',
  })
  const web = webAlreadyRunning ? null : runProcess('npx', ['vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    VITE_DEV_API_TARGET: `http://127.0.0.1:${apiPort}`,
    VITE_API_BASE_URL: '',
    VITE_AUTH_REQUIRED: 'false',
  })

  try {
    await waitForUrl(apiUrl, apiAlreadyRunning ? 'existing API server' : 'API server')
    await waitForUrl(baseUrl, 'Vite server')

    const e2e = spawn('node', [
      'scripts/prod-stage3-research-e2e.mjs',
      baseUrl,
      process.env.LOCAL_STAGE3_E2E_OUTPUT_DIR || '../outputs/ich_kano_entropy/local-stage3-research-e2e',
    ], {
      cwd: root,
      env: {
        ...process.env,
        PROD_STAGE3_E2E_KEEP: process.env.PROD_STAGE3_E2E_KEEP || '0',
        PLAYWRIGHT_BROWSER_CHANNEL: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome',
      },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    })

    const code = await new Promise(resolve => e2e.on('exit', resolve))
    if (code !== 0) throw new Error(`local Stage3 research E2E failed with exit code ${code}`)
  } finally {
    stop(web)
    stop(api)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
