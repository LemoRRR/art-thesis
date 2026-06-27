import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const baseUrl = (process.argv[2] || process.env.PROD_STAGE3_GENERATION_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const keepProject = process.env.PROD_STAGE3_GENERATION_KEEP === '1'
const outputDir = path.resolve(
  process.argv[3] || process.env.PROD_STAGE3_GENERATION_OUTPUT_DIR || path.join(os.tmpdir(), `stage3-generation-e2e-${Date.now()}`)
)

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

async function clickByTestId(page, testId, timeout = 30000) {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout })
  const clicked = await page.evaluate(id => {
    const element = document.querySelector(`[data-testid="${id}"]`)
    if (!element) return false
    element.click()
    return true
  }, testId)
  assert(clicked, `Could not click ${testId}`)
}

async function cleanup({ token, projectId }) {
  if (!token || keepProject) return
  await Promise.allSettled([
    requestJson('DELETE', `/api/outlines/project/${encodeURIComponent(projectId)}`, undefined, token),
    requestJson('DELETE', `/api/projects/${encodeURIComponent(projectId)}`, undefined, token),
  ])
}

function draftOutline() {
  return [
    {
      id: randomUUID(),
      level: 1,
      title: '研究背景与问题提出',
      order: '一',
      children: [
        { id: randomUUID(), level: 2, title: '非遗文创产品的传播语境', order: '1.1', children: [] },
        { id: randomUUID(), level: 2, title: '青年用户视觉偏好的研究问题', order: '1.2', children: [] },
      ],
    },
    {
      id: randomUUID(),
      level: 1,
      title: '结论与优化建议',
      order: '二',
      children: [
        { id: randomUUID(), level: 2, title: '主要研究结论', order: '2.1', children: [] },
        { id: randomUUID(), level: 2, title: '设计与传播优化建议', order: '2.2', children: [] },
      ],
    },
  ]
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  const { chromium } = loadPlaywright()
  const health = await requestJson('GET', '/api/health')
  assert(health?.ok === true, `Health check failed: ${JSON.stringify(health)}`)
  const login = await requestJson('POST', '/api/auth/demo-login', {})
  const token = login.session?.access_token
  assert(token, 'Demo login did not return access token')

  const projectId = randomUUID()
  let browser
  let page
  const browserErrors = []
  const apiResponses = []

  try {
    await requestJson('POST', '/api/projects', {
      id: projectId,
      title: 'Stage3 全文生成生产 E2E',
      current_stage: 'stage3',
      context: {
        smoke: true,
        createdBy: 'prod-stage3-generation-e2e',
        researchObject: '非遗文创产品视觉元素与青年用户评价',
        academicLevel: '本科',
        nextStepRecommendation: 'write_from_outline',
      },
    }, token)
    const outlineSections = draftOutline()
    await requestJson('PUT', `/api/outlines/project/${encodeURIComponent(projectId)}`, {
      sections: outlineSections,
      confirmed_at: new Date().toISOString(),
    }, token)

    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome', headless: true })
    const context = await browser.newContext({ acceptDownloads: true })
    await context.addInitScript(({ accessToken, user }) => {
      window.localStorage.setItem('access_token', accessToken)
      window.localStorage.setItem('auth_user', JSON.stringify(user))
    }, { accessToken: token, user: login.user })

    page = await context.newPage()
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type())) browserErrors.push(`${message.type()}: ${message.text()}`)
    })
    page.on('requestfailed', request => {
      browserErrors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
    })
    page.on('pageerror', error => {
      browserErrors.push(`pageerror: ${error.message}`)
    })
    page.on('response', response => {
      if (/\/api\/(chat|scholar|sections|outlines)/.test(response.url())) {
        apiResponses.push(`${response.status()} ${response.url().replace(baseUrl, '')}`)
      }
    })

    await page.goto(`${baseUrl}/projects/${projectId}/stage3?prodStage3GenerationE2E=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await clickByTestId(page, 'stage3-generate-full-center', 60000)
    await page.getByTestId('stage3-generation-progress').waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForFunction(() => {
      const text = document.body?.innerText ?? ''
      return /正在生成全文|正在生成第|全文已生成|保底初稿/.test(text)
    }, { timeout: 60000 })

    await page.waitForFunction(() => {
      const text = document.body?.innerText ?? ''
      return /全文已生成|全 文已生成|保底初稿|重新生成全文|导出 Word|全文已生成，可继续修改/.test(text) && !/AI 正在生成全文/.test(text)
    }, { timeout: 300000 })

    const sections = await requestJson('GET', `/api/sections/project/${encodeURIComponent(projectId)}`, undefined, token)
    assert(Array.isArray(sections), 'sections response should be an array')
    assert(sections.length >= 2, `expected generated sections, got ${sections.length}`)
    const generatedText = sections.map(section => `${section.title}\n${section.content ?? ''}`).join('\n')
    assert(/研究背景|结论|优化建议|非遗|文创/.test(generatedText), 'generated sections do not contain expected thesis content')
    assert(sections.every(section => section.content_doc || String(section.content ?? '').trim().length > 80), 'generated sections were not persisted with usable content')

    const bodyText = await page.locator('body').innerText({ timeout: 15000 })
    assert(/导出 Word|全文已生成|重新生成全文/.test(bodyText), 'Stage3 did not return to editable/exportable state after generation')

    const relevantErrors = browserErrors.filter(message => !/favicon|ResizeObserver/i.test(message))
    assert(relevantErrors.length === 0, `Browser errors:\n${relevantErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      projectId,
      sectionCount: sections.length,
      generatedChars: generatedText.length,
      apiResponses: apiResponses.slice(-20),
    }, null, 2))

    await browser.close()
    browser = null
  } catch (error) {
    if (page) {
      const screenshotPath = path.join(outputDir, 'failure.png')
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null)
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
      console.error(JSON.stringify({
        failureDiagnostics: {
          baseUrl,
          projectId,
          screenshotPath,
          apiResponses,
          browserErrors,
          bodyText: bodyText.slice(0, 3000),
        },
      }, null, 2))
    }
    throw error
  } finally {
    if (browser) await browser.close().catch(() => null)
    await cleanup({ token, projectId })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
