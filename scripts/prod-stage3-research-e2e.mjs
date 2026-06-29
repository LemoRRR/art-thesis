import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

import JSZip from 'jszip'
import XLSX from 'xlsx'

const require = createRequire(import.meta.url)
const baseUrl = (process.argv[2] || process.env.PROD_STAGE3_E2E_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const keepProject = process.env.PROD_STAGE3_E2E_KEEP === '1'
const smokePassword = process.env.PROD_STAGE3_E2E_SMOKE_PASSWORD || `Stage3ResearchSmoke-${Date.now()}!Aa1`
const smokeEmail = process.env.PROD_STAGE3_E2E_SMOKE_EMAIL || `stage3-research-smoke-${Date.now()}@example.com`
const outputDir = path.resolve(
  process.argv[3] || process.env.PROD_STAGE3_E2E_OUTPUT_DIR || path.join(os.tmpdir(), `stage3-research-e2e-${Date.now()}`)
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function withTimeout(promise, label, timeoutMs = 10_000) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

async function closeBrowserQuietly(browser, label = 'browser.close') {
  if (!browser) return
  await withTimeout(browser.close(), label, 10_000).catch(error => {
    console.warn(`[prod-stage3-research-e2e] ${label} skipped: ${error instanceof Error ? error.message : String(error)}`)
  })
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

  throw new Error(
    [
      'Playwright is required for this smoke test.',
      'Install it locally with `npm install -D playwright` or set PLAYWRIGHT_PACKAGE_PATH to an installed playwright package.',
      ...failures.map(item => `- ${item}`),
    ].join('\n')
  )
}

async function requestJson(method, route, body, token = '', timeoutMs = 60_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
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
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${method} ${route} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function getAuthContext() {
  if (process.env.PROD_STAGE3_E2E_SMOKE_EMAIL && process.env.PROD_STAGE3_E2E_SMOKE_PASSWORD) {
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
    displayName: 'Stage3 Research Smoke',
  })
  assert(registered.session?.access_token, 'Register did not return access token')
  return { token: registered.session.access_token, user: registered.user }
}

function writeSurveyWorkbook(filePath) {
  const rows = Array.from({ length: 100 }, (_item, index) => {
    const group = index % 3 === 0 ? '高频使用' : index % 3 === 1 ? '中频使用' : '低频使用'
    const base = 2.35 + (index % 8) * 0.25 + (group === '高频使用' ? 0.45 : group === '中频使用' ? 0.15 : -0.05)
    const clamp = value => Math.max(1, Math.min(5, Math.round(value)))
    return {
      使用频率: group,
      性别: index % 2 === 0 ? '女' : '男',
      年龄: index % 4 === 0 ? '18-25' : index % 4 === 1 ? '26-30' : index % 4 === 2 ? '31-35' : '36岁以上',
      视觉识别1: clamp(base),
      视觉识别2: clamp(base + 0.2),
      视觉识别3: clamp(base - 0.1),
      文化认同1: clamp(base + 0.1),
      文化认同2: clamp(base + 0.25),
      文化认同3: clamp(base - 0.05),
      互动体验1: clamp(base - 0.05),
      互动体验2: clamp(base + 0.12),
      互动体验3: clamp(base - 0.15),
      传播意愿1: clamp(base + 0.18),
      传播意愿2: clamp(base + 0.25),
      传播意愿3: clamp(base - 0.05),
    }
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '问卷数据')
  XLSX.writeFile(workbook, filePath)
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

async function uploadFileByChangeEvent(page, testId, filePath) {
  const fileName = path.basename(filePath)
  const base64 = fs.readFileSync(filePath).toString('base64')
  const uploaded = await page.evaluate(({ id, name, fileBase64 }) => {
    const input = document.querySelector(`[data-testid="${id}"]`)
    if (!(input instanceof HTMLInputElement)) return false
    const binary = atob(fileBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    const file = new File([bytes], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, { id: testId, name: fileName, fileBase64: base64 })
  assert(uploaded, `Could not upload file through ${testId}`)
}

function plainTextFromDocumentXml(xml) {
  return Array.from(String(xml).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

function assertCaptionSequence(text, label, minimumCount) {
  const matches = Array.from(text.matchAll(new RegExp(`${label}4[-—-](\\d+)`, 'g')))
    .map(match => ({ number: Number(match[1]), index: match.index ?? 0 }))
  const unique = []
  for (const match of matches) {
    if (!unique.some(item => item.number === match.number)) unique.push(match)
  }
  assert(unique.length >= minimumCount, `DOCX has too few ${label}4-x captions: ${unique.length}`)
  assert(unique[0].number === 1, `DOCX first ${label} caption should be ${label}4-1, got ${label}4-${unique[0].number}`)
  for (let index = 1; index < unique.length; index += 1) {
    assert(
      unique[index - 1].number < unique[index].number,
      `DOCX ${label} captions are out of order: ${unique.map(item => `${label}4-${item.number}`).join(', ')}`
    )
  }
}

function sectionSlice(text, startPattern, endPattern, label) {
  const start = text.search(startPattern)
  assert(start >= 0, `DOCX is missing ${label} section`)
  const rest = text.slice(start)
  const end = rest.search(endPattern)
  return end >= 0 ? rest.slice(0, end) : rest
}

function assertResearchSectionIntegration(text) {
  const methodText = sectionSlice(text, /研究设计与数据来源/, /数据分析与研究结果/, 'method')
  const resultText = sectionSlice(text, /数据分析与研究结果/, /讨论与优化建议/, 'result')
  const discussionText = sectionSlice(text, /讨论与优化建议/, /$^/, 'discussion')

  assert(!/Descriptive statistics for all variables|Correlation analysis among numeric variables|Correlation matrix for numeric variables|ANOVA for group comparisons|Cronbach[’']?s alpha for reliability/i.test(methodText), 'DOCX method section contains raw English tool descriptions')
  assert(!/未指定具体模型|待确认具体模型|鏈|鏈|鎖|鐢|绌/.test(methodText), 'DOCX method section contains placeholder or mojibake method text')
  assert(!/系统内置|轻量统计|Python\/R|上传数据|兜底|工具/.test(methodText), 'DOCX method section contains tool/workflow wording')
  assert(/问卷|样本|变量|统计方法|信度|相关|方差|因子/.test(methodText), 'DOCX method section lacks research design/method wording')
  assert(!/表4[-—-]\d+|图4[-—-]\d+/.test(methodText), 'DOCX method section should not contain result table/figure captions')
  assert(/表4[-—-]\d+/.test(resultText), 'DOCX result section lacks table captions')
  assert(/图4[-—-]\d+/.test(resultText), 'DOCX result section lacks figure captions')
  assert(/由表|由图|结果显示|可见|说明|表明|用于/.test(resultText), 'DOCX result section lacks paper-style interpretation around tables/figures')
  assert((resultText.match(/表4[-—-]\d+/g) ?? []).length >= 4, 'DOCX result section has too few research tables')
  assert((resultText.match(/图4[-—-]\d+/g) ?? []).length >= 3, 'DOCX result section has too few research figures')
  assert(/本次定量分析基于|分析方法包括|描述统计结果显示|信度分析结果显示/.test(resultText), 'DOCX result section lacks consolidated statistical interpretation text')
  assert(!/Cronbach[’']?s alpha 为|相关系数为 r=|检验结果为 F=/.test(discussionText), 'DOCX discussion section contains detailed result interpretation that belongs in the result section')
  assert(/回应研究问题|策略建议|优化方向|样本边界|过度外推|数据质量/.test(discussionText), 'DOCX discussion section lacks thesis-style synthesis and limitation framing')
  assert(/讨论|建议|策略|优化|启示|路径|重点|后续/.test(discussionText), 'DOCX discussion section lacks discussion/suggestion wording')
}

async function inspectDownloadedDocx(filePath) {
  const buffer = fs.readFileSync(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert(documentXml, 'DOCX is missing word/document.xml')
  const text = plainTextFromDocumentXml(documentXml)
  assert(/研究设计与数据来源/.test(text), 'DOCX is missing method chapter heading')
  assert(/数据分析与研究结果/.test(text), 'DOCX is missing result chapter heading')
  assert(/讨论与优化建议/.test(text), 'DOCX is missing discussion chapter heading')
  assert(/数据质量与方法适用性检查表/.test(text), 'DOCX is missing data quality table')
  assert(/描述性统计表/.test(text), 'DOCX is missing descriptive statistics table')
  assert(/描述统计均值图/.test(text), 'DOCX is missing descriptive mean figure')
  assertResearchSectionIntegration(text)
  assertCaptionSequence(text, '表', 4)
  assertCaptionSequence(text, '图', 3)
  assert(!/table_data_quality|table_descriptive|figure_descriptive_means|research_component/.test(text), 'DOCX leaked internal research ids')
  assert(!/分析方法包括[^。]*(descriptive|cronbach_alpha|correlation|anova|efa|mediation_model_4)/i.test(text), 'DOCX leaked internal method ids in prose')
  assert(!/未计算|p=未/.test(text), 'DOCX contains unpolished significance placeholders')

  const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'))
  assert(media.length >= 3, `DOCX should contain at least 3 generated figures, got ${media.length}`)
  const pngChecks = []
  for (const name of media) {
    const mediaBuffer = await zip.file(name)?.async('nodebuffer')
    assert(mediaBuffer && mediaBuffer.length > 25, `DOCX image is empty: ${name}`)
    if (!name.toLowerCase().endsWith('.png')) continue
    assert(mediaBuffer.toString('ascii', 1, 4) === 'PNG', `DOCX image is not a valid PNG: ${name}`)
    const width = mediaBuffer.readUInt32BE(16)
    const height = mediaBuffer.readUInt32BE(20)
    const colorType = mediaBuffer[25]
    assert(width >= 900, `DOCX PNG width is too low: ${name} ${width}`)
    assert(height >= 250, `DOCX PNG height is too low: ${name} ${height}`)
    assert(colorType !== 4 && colorType !== 6, `DOCX PNG image must be flattened without alpha: ${name}`)
    pngChecks.push({ name, width, height, colorType })
  }
  assert(pngChecks.length >= 3, `DOCX should contain at least 3 validated PNG figures, got ${pngChecks.length}`)
  return {
    tableCaptions: (text.match(/表4[-—-]\d+/g) ?? []).length,
    figureCaptions: (text.match(/图4[-—-]\d+/g) ?? []).length,
    mediaCount: media.length,
    validatedPngCount: pngChecks.length,
    minImagePixels: pngChecks.reduce(
      (min, item) => ({
        width: Math.min(min.width, item.width),
        height: Math.min(min.height, item.height),
      }),
      { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }
    ),
  }
}

async function cleanup({ token, projectId, sectionIds, packageIds }) {
  if (!token || keepProject) return
  await Promise.allSettled([
    ...sectionIds.map(id => requestJson('DELETE', `/api/sections/${encodeURIComponent(id)}`, undefined, token, 10_000)),
    ...packageIds.map(id => requestJson('DELETE', `/api/research-packages/${encodeURIComponent(id)}`, undefined, token, 10_000)),
    requestJson('DELETE', `/api/projects/${encodeURIComponent(projectId)}`, undefined, token, 10_000),
  ])
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  const { chromium } = loadPlaywright()
  const health = await requestJson('GET', '/api/health')
  assert(health?.ok === true, `Health check failed: ${JSON.stringify(health)}`)

  const { token, user } = await getAuthContext()

  const projectId = randomUUID()
  const sectionIds = [randomUUID(), randomUUID(), randomUUID()]
  const packageIds = []
  let browser
  let page
  const apiResponses = []
  const browserErrors = []

  try {
    await requestJson('POST', '/api/projects', {
      id: projectId,
      title: 'Stage3 研究计算生产 E2E',
      current_stage: 'stage3',
      context: { smoke: true, createdBy: 'prod-stage3-research-e2e' },
    }, token)
    await requestJson('PUT', `/api/sections/project/${encodeURIComponent(projectId)}`, {
      sections: [
        {
          id: sectionIds[0],
          title: '三、研究设计与数据来源',
          content: '本章说明问卷数据来源、变量测量和统计方法。',
          status: 'done',
          sort_order: 0,
        },
        {
          id: sectionIds[1],
          title: '四、数据分析与研究结果',
          content: '本章用于呈现描述统计、信度、相关、方差和因子分析结果。',
          status: 'done',
          sort_order: 1,
        },
        {
          id: sectionIds[2],
          title: '五、讨论与优化建议',
          content: '本章围绕研究结果提出优化建议。',
          status: 'done',
          sort_order: 2,
        },
      ],
    }, token)

    const workbookPath = path.join(outputDir, 'stage3-research-e2e-survey.xlsx')
    writeSurveyWorkbook(workbookPath)

    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome', headless: true })
    const context = await browser.newContext({ acceptDownloads: true })
    await context.addInitScript(({ accessToken, user }) => {
      window.localStorage.setItem('access_token', accessToken)
      window.localStorage.setItem('auth_user', JSON.stringify(user))
    }, { accessToken: token, user })

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
      if (response.url().includes('/api/research')) {
        apiResponses.push(`${response.status()} ${response.url().replace(baseUrl, '')}`)
      }
    })

    await page.goto(`${baseUrl}/projects/${projectId}/stage3?prodStage3ResearchE2E=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await clickByTestId(page, 'stage3-open-research')
    await page.getByTestId('research-upload-input').waitFor({ state: 'attached', timeout: 30000 })
    await uploadFileByChangeEvent(page, 'research-upload-input', workbookPath)
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="research-generate-plan"]')
      return button instanceof HTMLButtonElement && !button.disabled
    }, { timeout: 30000 })
    await clickByTestId(page, 'research-generate-plan')
    await page.getByTestId('research-run-plan').waitFor({ state: 'visible', timeout: 180000 })
    await clickByTestId(page, 'research-run-plan')
    await page.getByTestId('research-insert-latest').waitFor({ state: 'visible', timeout: 240000 })
    await clickByTestId(page, 'research-insert-latest')
    await page.waitForFunction(() => {
      const text = document.body?.innerText ?? ''
      return /表4[-—-]1/.test(text) && /图4[-—-]1/.test(text)
    }, { timeout: 120000 })

    const bodyText = await page.locator('body').innerText({ timeout: 15000 })
    assert(/表4[-—-]1/.test(bodyText) && /图4[-—-]1/.test(bodyText), 'Inserted research content is not visible in Stage3')

    const packages = await requestJson('GET', `/api/research-packages/project/${encodeURIComponent(projectId)}`, undefined, token)
    for (const item of Array.isArray(packages) ? packages : []) {
      if (item?.id) packageIds.push(item.id)
    }
    assert(packageIds.length >= 1, 'Research package was not persisted')

    const downloadPromise = page.waitForEvent('download', { timeout: 45000 })
    await clickByTestId(page, 'document-export-word')
    const download = await downloadPromise
    const savedPath = path.join(outputDir, download.suggestedFilename() || 'stage3-research-e2e.docx')
    await download.saveAs(savedPath)
    const bytes = fs.statSync(savedPath).size
    assert(bytes > 10000, `Downloaded DOCX is too small: ${bytes}`)
    const docxInspection = await inspectDownloadedDocx(savedPath)

    const relevantErrors = browserErrors.filter(message => !/favicon|ResizeObserver/i.test(message))
    assert(relevantErrors.length === 0, `Browser errors:\n${relevantErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      projectId,
      packageCount: packageIds.length,
      apiResponses,
      downloadedDocx: savedPath,
      bytes,
      docxInspection,
    }, null, 2))

    await closeBrowserQuietly(browser)
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
    if (browser) await closeBrowserQuietly(browser)
    await withTimeout(cleanup({ token, projectId, sectionIds, packageIds }), 'cleanup', 20_000).catch(error => {
      console.warn(`[prod-stage3-research-e2e] cleanup skipped: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
