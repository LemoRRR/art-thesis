import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const baseUrl = (process.argv[2] || process.env.PROD_CLOUD_RESTORE_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const keepProject = process.env.PROD_CLOUD_RESTORE_KEEP === '1'
const smokePassword = process.env.PROD_CLOUD_RESTORE_PASSWORD || `CloudRestoreSmoke-${Date.now()}!Aa1`
const smokeEmail = process.env.PROD_CLOUD_RESTORE_EMAIL || `cloud-restore-smoke-${Date.now()}@example.com`
const outputDir = path.resolve(process.argv[3] || process.env.PROD_CLOUD_RESTORE_OUTPUT_DIR || path.join(os.tmpdir(), `cloud-restore-smoke-${Date.now()}`))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_PACKAGE_PATH,
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
  ].filter(Boolean)
  const failures = []
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`)
    }
  }
  throw new Error(`Playwright is required.\n${failures.map(item => `- ${item}`).join('\n')}`)
}

async function requestJson(method, route, body, token = '') {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
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
}

async function getAuthContext() {
  if (process.env.PROD_CLOUD_RESTORE_EMAIL && process.env.PROD_CLOUD_RESTORE_PASSWORD) {
    const login = await requestJson('POST', '/api/auth/login', {
      email: smokeEmail,
      password: smokePassword,
    })
    assert(login.session?.access_token, 'Configured smoke account login did not return access token')
    return { token: login.session.access_token, user: login.user }
  }

  const registered = await requestJson('POST', '/api/auth/register', {
    email: smokeEmail,
    password: smokePassword,
    displayName: 'Cloud Restore Smoke',
  })
  assert(registered.session?.access_token, 'Register did not return access token')
  return { token: registered.session.access_token, user: registered.user }
}

async function cleanup({ token, projectId, packageId, sectionIds }) {
  if (!token || keepProject) return
  await Promise.allSettled([
    requestJson('DELETE', `/api/research-packages/${encodeURIComponent(packageId)}`, undefined, token),
    ...sectionIds.map(id => requestJson('DELETE', `/api/sections/${encodeURIComponent(id)}`, undefined, token)),
    requestJson('DELETE', `/api/outlines/project/${encodeURIComponent(projectId)}`, undefined, token),
    requestJson('DELETE', `/api/projects/${encodeURIComponent(projectId)}`, undefined, token),
  ])
}

async function main() {
  const { chromium } = loadPlaywright()
  const health = await requestJson('GET', '/api/health')
  assert(health?.ok === true, `Health check failed: ${JSON.stringify(health)}`)

  const { token } = await getAuthContext()
  const projectId = randomUUID()
  const sectionIds = [randomUUID(), randomUUID()]
  const packageId = randomUUID()
  const projectTitle = '云端恢复生产冒烟项目'
  const uniqueMarker = `云端恢复标记-${Date.now()}`
  let browser
  let page
  const browserErrors = []

  try {
    await requestJson('POST', '/api/projects', {
      id: projectId,
      title: projectTitle,
      description: '用于验证换浏览器登录后项目、大纲、正文和研究包能恢复。',
      current_stage: 'stage3',
      context: {
        smoke: true,
        createdBy: 'prod-cloud-restore-smoke',
        researchObject: '非遗文创产品青年用户评价',
      },
    }, token)

    await requestJson('PUT', `/api/outlines/project/${encodeURIComponent(projectId)}`, {
      sections: [
        {
          id: sectionIds[0],
          level: 1,
          title: '研究背景与问题提出',
          order: '一',
          children: [],
        },
        {
          id: sectionIds[1],
          level: 1,
          title: '数据分析与研究结果',
          order: '二',
          children: [],
        },
      ],
      confirmed_at: new Date().toISOString(),
    }, token)

    await requestJson('PUT', `/api/sections/project/${encodeURIComponent(projectId)}`, {
      sections: [
        {
          id: sectionIds[0],
          title: '一、研究背景与问题提出',
          content: `${uniqueMarker}。本节用于验证云端正文恢复，内容围绕非遗文创产品视觉评价展开。`,
          status: 'done',
        },
        {
          id: sectionIds[1],
          title: '二、数据分析与研究结果',
          content: '本节用于承载研究计算图表和结论说明，验证写入后的章节可恢复。',
          status: 'done',
        },
      ],
    }, token)

    const now = Date.now()
    const researchPackage = {
      id: packageId,
      projectId,
      title: '云端恢复研究包',
      method: 'descriptive',
      intentSummary: '验证研究资产跨浏览器恢复。',
      components: [
        {
          id: 'restore_component_method',
          type: 'method',
          title: '研究方法说明',
          content: '本研究包用于验证云端恢复链路，不参与真实论文结论。',
          sectionRole: 'method',
        },
      ],
      insertedComponentIds: ['restore_component_method'],
      versions: [],
      createdAt: now,
      updatedAt: now,
    }
    await requestJson('PUT', `/api/research-packages/${encodeURIComponent(packageId)}`, {
      package: researchPackage,
    }, token)

    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome', headless: true })
    const context = await browser.newContext({ acceptDownloads: true })
    page = await context.newPage()
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type())) browserErrors.push(`${message.type()}: ${message.text()}`)
    })
    page.on('pageerror', error => {
      browserErrors.push(`pageerror: ${error.message}`)
    })
    page.on('requestfailed', request => {
      browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
    })

    await page.goto(`${baseUrl}/login?redirect=${encodeURIComponent(`/projects/${projectId}/stage3?cloudRestoreSmoke=${Date.now()}`)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await page.locator('input[type="email"]').fill(smokeEmail)
    await page.locator('input[type="password"]').fill(smokePassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(new RegExp(`/projects/${projectId}/stage3`), { timeout: 60000 })
    await page.waitForFunction(marker => document.body?.innerText?.includes(marker), uniqueMarker, { timeout: 30000 })

    const restored = await page.evaluate(async ({ projectId, packageId }) => {
      const token = window.localStorage.getItem('access_token')
      const headers = token ? { authorization: `Bearer ${token}` } : {}
      const [outlineRes, sectionsRes, packagesRes] = await Promise.all([
        fetch(`/api/outlines/project/${projectId}`, { headers }),
        fetch(`/api/sections/project/${projectId}`, { headers }),
        fetch(`/api/research-packages/project/${projectId}`, { headers }),
      ])
      const [outline, sections, packages] = await Promise.all([
        outlineRes.json(),
        sectionsRes.json(),
        packagesRes.json(),
      ])
      return {
        hasToken: Boolean(token),
        outlineCount: Array.isArray(outline?.sections) ? outline.sections.length : 0,
        sectionCount: Array.isArray(sections) ? sections.length : 0,
        packageFound: Array.isArray(packages) && packages.some(pkg => pkg.id === packageId),
      }
    }, { projectId, packageId })

    assert(restored.hasToken, 'New browser login did not store auth token')
    assert(restored.outlineCount >= 2, `Restored outline is missing sections: ${JSON.stringify(restored)}`)
    assert(restored.sectionCount >= 2, `Restored sections are missing: ${JSON.stringify(restored)}`)
    assert(restored.packageFound, `Restored research package is missing: ${JSON.stringify(restored)}`)
    const bodyText = await page.locator('body').innerText({ timeout: 10000 })
    assert(bodyText.includes(projectTitle) || bodyText.includes(uniqueMarker), 'Stage3 did not show restored project content')
    const relevantErrors = browserErrors.filter(message => !/favicon|ResizeObserver/i.test(message))
    assert(relevantErrors.length === 0, `Browser errors:\n${relevantErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      projectId,
      restored,
      markerVisible: bodyText.includes(uniqueMarker),
    }, null, 2))
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => null)
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
      console.error(JSON.stringify({
        failureDiagnostics: {
          baseUrl,
          projectId,
          outputDir,
          browserErrors,
          bodyText: bodyText.slice(0, 3000),
        },
      }, null, 2))
    }
    throw error
  } finally {
    if (browser) await browser.close().catch(() => null)
    await cleanup({ token, projectId, packageId, sectionIds })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
