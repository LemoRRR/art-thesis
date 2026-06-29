import { randomUUID } from 'node:crypto'

const baseUrl = (process.argv[2] || process.env.PROD_DEMO_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const email = process.env.PROD_DEMO_EMAIL || `customer-demo-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`
const password = process.env.PROD_DEMO_PASSWORD || `CustomerDemo-${randomUUID()}!Aa1`
const displayName = process.env.PROD_DEMO_DISPLAY_NAME || '客户演示账号'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function requestJson(method, route, body, token = '', timeoutMs = 30_000) {
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

async function getAuthToken() {
  if (process.env.PROD_DEMO_EMAIL && process.env.PROD_DEMO_PASSWORD) {
    try {
      const login = await requestJson('POST', '/api/auth/login', { email, password })
      assert(login.session?.access_token, 'Configured demo account login did not return access token')
      return { token: login.session.access_token, createdAccount: false }
    } catch (error) {
      const registered = await requestJson('POST', '/api/auth/register', {
        email,
        password,
        displayName,
      })
      assert(registered.session?.access_token, `Could not login or register configured demo account: ${error instanceof Error ? error.message : String(error)}`)
      return { token: registered.session.access_token, createdAccount: true }
    }
  }

  const registered = await requestJson('POST', '/api/auth/register', {
    email,
    password,
    displayName,
  })
  assert(registered.session?.access_token, 'Register did not return access token')
  return { token: registered.session.access_token, createdAccount: true }
}

function paragraphDoc(text) {
  return {
    type: 'doc',
    content: text
      .split(/\n{2,}/)
      .map(paragraph => paragraph.trim())
      .filter(Boolean)
      .map(paragraph => ({
        type: 'paragraph',
        content: [{ type: 'text', text: paragraph }],
      })),
  }
}

function demoOutline(sectionIds) {
  return [
    {
      id: sectionIds[0],
      level: 1,
      title: '摘要',
      order: '',
      children: [],
    },
    {
      id: sectionIds[1],
      level: 1,
      title: '研究背景与问题提出',
      order: '一',
      children: [
        { id: randomUUID(), level: 2, title: '非遗文创产品的消费语境', order: '1.1', children: [] },
        { id: randomUUID(), level: 2, title: '青年用户视觉偏好的研究问题', order: '1.2', children: [] },
      ],
    },
    {
      id: sectionIds[2],
      level: 1,
      title: '研究设计与数据来源',
      order: '二',
      children: [
        { id: randomUUID(), level: 2, title: 'KANO模型与熵权法耦合思路', order: '2.1', children: [] },
        { id: randomUUID(), level: 2, title: '问卷样本与指标设置', order: '2.2', children: [] },
      ],
    },
    {
      id: sectionIds[3],
      level: 1,
      title: '数据分析与研究结果',
      order: '三',
      children: [
        { id: randomUUID(), level: 2, title: 'KANO分类结果', order: '3.1', children: [] },
        { id: randomUUID(), level: 2, title: '熵权法权重与优先级排序', order: '3.2', children: [] },
      ],
    },
    {
      id: sectionIds[4],
      level: 1,
      title: '优化策略与结论',
      order: '四',
      children: [
        { id: randomUUID(), level: 2, title: '视觉元素优化策略', order: '4.1', children: [] },
        { id: randomUUID(), level: 2, title: '研究结论与不足', order: '4.2', children: [] },
      ],
    },
  ]
}

function demoSections(projectId, sectionIds) {
  const rows = [
    {
      title: '摘要',
      content: '本文以非遗文创产品的青年用户评价为研究对象，结合KANO模型与熵权法识别视觉元素的需求属性和优化优先级。研究围绕文化符号、色彩表现、材质体验、互动传播等维度建立评价指标，并通过问卷数据分析不同元素对用户满意度和购买意愿的影响。结果表明，文化识别度、视觉吸引力与情感共鸣是影响青年用户评价的重要因素。',
    },
    {
      title: '一、研究背景与问题提出',
      content: '近年来，非遗文创产品逐渐从单纯纪念品转向具有审美表达、文化传播和生活使用价值的综合型产品。青年用户既关注产品是否具有传统文化符号，也关注其视觉风格是否符合当代消费场景。\n\n因此，本研究关注的问题是：非遗文创产品中的哪些视觉元素会被青年用户视为基础需求、期望需求或魅力需求；不同视觉元素在综合评价中的权重如何；设计优化应优先处理哪些因素。',
    },
    {
      title: '二、研究设计与数据来源',
      content: '本研究采用KANO模型识别用户对视觉元素的需求属性，并结合熵权法计算各指标的客观权重。KANO模型用于区分必备型、期望型、魅力型、无差异型等需求类型，熵权法则依据样本数据离散程度确定指标权重，从而降低单一主观判断带来的偏差。\n\n问卷围绕文化符号、色彩搭配、图案创新、材质表达、实用功能、社交传播等维度设置正反向题项，并将结果写入研究计算模块生成表格、图像和论文表述。',
    },
    {
      title: '三、数据分析与研究结果',
      content: '研究计算模块可在本章写入KANO分类汇总表、Better-Worse系数图、熵权法权重表和综合优先级排序图。演示时可上传Excel并点击生成分析方案，系统会先识别数据结构，再生成论文可用的图表和结果解释。\n\n从论文写作角度看，图表不应作为独立模块堆叠，而应围绕研究问题嵌入本章：先说明表格反映的计算结果，再解释图像所呈现的趋势，最后把发现转化为设计策略依据。',
    },
    {
      title: '四、优化策略与结论',
      content: '基于KANO分类和熵权排序结果，非遗文创产品设计应优先保证文化符号的清晰识别和视觉表达的现代转译，在此基础上增强产品的实用性、故事性和社交传播属性。对于青年用户而言，文化价值并非只来自传统元素的堆砌，而来自传统语义与当代生活方式之间的有效连接。\n\n后续研究可进一步扩大样本范围，并结合访谈、AHP或回归分析验证不同视觉因素对购买意愿和传播意愿的影响路径。',
    },
  ]

  return rows.map((row, index) => ({
    id: sectionIds[index],
    project_id: projectId,
    title: row.title,
    content: row.content,
    content_doc: paragraphDoc(row.content),
    status: 'done',
    sort_order: index,
  }))
}

function demoResearchPackage(projectId) {
  const now = Date.now()
  const packageId = randomUUID()
  return {
    id: packageId,
    projectId,
    title: '演示研究包：KANO-熵权分析',
    method: 'kano_entropy',
    intentSummary: '演示项目预置研究包，用于说明研究计算结果可以沉淀为资产并写入论文。',
    components: [
      {
        id: 'demo_method',
        type: 'method',
        title: '研究方法说明',
        content: '本研究包用于演示KANO模型与熵权法在非遗文创视觉元素评价中的应用路径。',
        sectionRole: 'method',
      },
      {
        id: 'demo_result_summary',
        type: 'analysis',
        title: '结果解释示例',
        content: '由KANO分类与权重排序可以看出，文化识别度和视觉吸引力更适合作为优先优化指标。',
        sectionRole: 'result',
      },
    ],
    insertedComponentIds: ['demo_method', 'demo_result_summary'],
    versions: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function main() {
  const health = await requestJson('GET', '/api/health')
  assert(health?.ok === true, `Health check failed: ${JSON.stringify(health)}`)

  const { token, createdAccount } = await getAuthToken()
  const projectId = process.env.PROD_DEMO_PROJECT_ID || randomUUID()
  const sectionIds = Array.from({ length: 5 }, () => randomUUID())
  const title = process.env.PROD_DEMO_PROJECT_TITLE || '客户演示项目：非遗文创KANO-熵权论文'

  await requestJson('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, {
    title,
    description: '预置演示项目：包含大纲、正文、研究计算说明和研究包，可直接用于客户演示。',
    current_stage: 'stage3',
    context: {
      researchObject: '非遗文创产品视觉元素与青年用户评价',
      academicLevel: '本科',
      writingBoundary: '围绕KANO模型、熵权法和论文写作工作流进行演示。',
      rawSummary: '客户演示项目，展示从论文正文到研究计算和Word导出的完整链路。',
    },
    library_item_ids: [],
  }, token)

  await requestJson('PUT', `/api/outlines/project/${encodeURIComponent(projectId)}`, {
    sections: demoOutline(sectionIds),
    confirmed_at: new Date().toISOString(),
  }, token)

  await requestJson('PUT', `/api/sections/project/${encodeURIComponent(projectId)}`, {
    sections: demoSections(projectId, sectionIds),
  }, token)

  const pkg = demoResearchPackage(projectId)
  await requestJson('PUT', `/api/research-packages/${encodeURIComponent(pkg.id)}`, { package: pkg }, token)

  const [project, sections, outline, packages] = await Promise.all([
    requestJson('GET', `/api/projects/${encodeURIComponent(projectId)}`, undefined, token),
    requestJson('GET', `/api/sections/project/${encodeURIComponent(projectId)}`, undefined, token),
    requestJson('GET', `/api/outlines/project/${encodeURIComponent(projectId)}`, undefined, token),
    requestJson('GET', `/api/research-packages/project/${encodeURIComponent(projectId)}`, undefined, token),
  ])

  assert(project?.id === projectId, 'Seeded project could not be fetched')
  assert(Array.isArray(sections) && sections.length === 5, `Expected 5 seeded sections, got ${sections?.length}`)
  assert(Array.isArray(outline?.sections) && outline.sections.length === 5, 'Seeded outline is incomplete')
  assert(Array.isArray(packages) && packages.some(item => item.id === pkg.id), 'Seeded research package is missing')

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    account: {
      email,
      password,
      createdAccount,
      configuredAccount: Boolean(process.env.PROD_DEMO_EMAIL && process.env.PROD_DEMO_PASSWORD),
    },
    project: {
      id: projectId,
      title,
      url: `${baseUrl}/projects/${projectId}/stage3`,
      sectionCount: sections.length,
      outlineCount: outline.sections.length,
      researchPackageCount: packages.length,
    },
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
