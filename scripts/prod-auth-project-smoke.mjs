import { randomUUID } from 'node:crypto'

const baseUrl = (process.argv[2] || process.env.PROD_AUTH_SMOKE_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const password = process.env.PROD_AUTH_SMOKE_PASSWORD || `DeliverySmoke-${randomUUID()}!Aa1`
const email = process.env.PROD_AUTH_SMOKE_EMAIL || `delivery-smoke-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function requestJson(method, route, body, token = '', timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const json = text ? JSON.parse(text) : null
    if (!response.ok || json?.ok === false) {
      throw new Error(`${method} ${route} ${response.status}: ${text.slice(0, 1200)}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const health = await requestJson('GET', '/api/health')
  assert(health?.ok === true, `Health check failed: ${JSON.stringify(health)}`)

  const registered = await requestJson('POST', '/api/auth/register', {
    email,
    password,
    displayName: 'Delivery Smoke',
  })
  const registerToken = registered.session?.access_token
  assert(registerToken, 'Register did not return an access token. Check Supabase email confirmation settings.')

  const login = await requestJson('POST', '/api/auth/login', { email, password })
  const token = login.session?.access_token
  assert(token, 'Login did not return access token')

  const me = await requestJson('GET', '/api/auth/me', undefined, token)
  assert(me.user?.email === email, `Auth /me returned unexpected user: ${JSON.stringify(me.user)}`)

  const projectId = randomUUID()
  const created = await requestJson('POST', '/api/projects', {
    id: projectId,
    title: '交付验收冒烟项目',
    description: '用于验证正式账号、项目创建和云端读写。',
    current_stage: 'stage1',
    context: { researchObject: '正式交付链路' },
    library_item_ids: [],
  }, token)
  assert(created?.id === projectId, `Project create returned unexpected id: ${JSON.stringify(created)}`)

  const list = await requestJson('GET', '/api/projects', undefined, token)
  assert(Array.isArray(list) && list.some(project => project.id === projectId), 'Created project was not returned by project list')

  const fetched = await requestJson('GET', `/api/projects/${encodeURIComponent(projectId)}`, undefined, token)
  assert(fetched?.title === '交付验收冒烟项目', `Fetched project title mismatch: ${JSON.stringify(fetched)}`)

  const patched = await requestJson('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, {
    title: '交付验收冒烟项目-已更新',
    current_stage: 'stage2',
  }, token)
  assert(patched?.title === '交付验收冒烟项目-已更新', `Project patch failed: ${JSON.stringify(patched)}`)

  await requestJson('DELETE', `/api/projects/${encodeURIComponent(projectId)}`, undefined, token)
  const afterDelete = await requestJson('GET', '/api/projects', undefined, token)
  assert(!afterDelete.some(project => project.id === projectId), 'Deleted project still appears in project list')

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    auth: {
      registered: true,
      login: true,
      me: true,
    },
    project: {
      created: true,
      listed: true,
      fetched: true,
      patched: true,
      deleted: true,
    },
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
