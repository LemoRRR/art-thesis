const baseUrl = (process.argv[2] || process.env.PROD_CITATION_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const smokePassword = process.env.PROD_CITATION_SMOKE_PASSWORD || `CitationSmoke-${Date.now()}!Aa1`
const smokeEmail = process.env.PROD_CITATION_SMOKE_EMAIL || `citation-smoke-${Date.now()}@example.com`

function assert(condition, message) {
  if (!condition) throw new Error(message)
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

async function getAuthToken() {
  if (process.env.PROD_CITATION_SMOKE_EMAIL && process.env.PROD_CITATION_SMOKE_PASSWORD) {
    const login = await requestJson('POST', '/api/auth/login', {
      email: smokeEmail,
      password: smokePassword,
    })
    assert(login.session?.access_token, 'Configured smoke account login did not return access token')
    return login.session.access_token
  }

  const registered = await requestJson('POST', '/api/auth/register', {
    email: smokeEmail,
    password: smokePassword,
    displayName: 'Citation Smoke',
  })
  assert(registered.session?.access_token, 'Register did not return access token')
  return registered.session.access_token
}

function assertPatchQuality(patches, expectedMin) {
  assert(Array.isArray(patches), 'patches must be an array')
  assert(patches.length >= expectedMin, `expected at least ${expectedMin} citation patches, got ${patches.length}`)
  const sectionIds = new Set()
  const sourceIds = new Set()
  const candidateIds = new Set()
  const sourceUseCounts = new Map()
  for (const patch of patches) {
    assert(patch.sectionId, 'patch is missing sectionId')
    assert(patch.candidateId, 'patch is missing candidateId; source grounding cannot be traced to a sentence')
    assert(!candidateIds.has(patch.candidateId), `duplicate citation patch candidateId: ${patch.candidateId}`)
    candidateIds.add(patch.candidateId)
    assert(patch.originalText && patch.revisedText, 'patch is missing replacement text')
    assert(String(patch.originalText).length >= 18, 'patch original text is too short to be a meaningful claim')
    assert(patch.source?.id && patch.source?.title, 'patch is missing bound source metadata')
    assert(Array.isArray(patch.source.authors) && patch.source.authors.length > 0, 'patch source is missing authors')
    assert(patch.source.doi || patch.source.url, 'patch source is missing DOI/URL')
    assert(String(patch.reason ?? '').length >= 20, 'patch is missing a useful grounding reason')
    assert(Number(patch.confidence ?? 0) >= 0.5, `patch confidence is too low: ${patch.confidence}`)
    assert(!/\{\{cite:|\[[0-9,\s]+\]|(?:^|[^\w])S\d+(?:[^\w]|$)/i.test(patch.revisedText), 'patch leaked inline citation marker')
    assert(patch.applyMode === 'citation_only' || patch.applyMode === 'rewrite_with_citation', `unexpected applyMode: ${patch.applyMode}`)
    if (patch.applyMode === 'citation_only') {
      assert(patch.revisedText === patch.originalText, 'citation_only patch should not rewrite the source sentence')
    } else {
      assert(patch.revisedText !== patch.originalText, 'rewrite_with_citation patch should revise the source sentence')
    }
    sectionIds.add(patch.sectionId)
    sourceIds.add(patch.source.id)
    sourceUseCounts.set(patch.source.id, (sourceUseCounts.get(patch.source.id) ?? 0) + 1)
  }
  assert(sourceIds.size >= Math.min(2, expectedMin), `citation patches used too few distinct sources: ${sourceIds.size}`)
  const maxSourceReuse = Math.max(...sourceUseCounts.values())
  assert(maxSourceReuse <= Math.ceil(patches.length / 2), `one source is overused across citation patches: ${maxSourceReuse}/${patches.length}`)
  return { sectionIds: Array.from(sectionIds), sourceIds: Array.from(sourceIds) }
}

async function main() {
  const health = await requestJson('GET', '/api/health')
  assert(health?.ok === true, `Health check failed: ${JSON.stringify(health)}`)

  const token = await getAuthToken()

  const sections = [
    {
      id: 's2',
      title: '二、理论基础与研究方法',
      content: [
        'KANO模型能够区分必备型、期望型和魅力型需求，因此适合用于识别用户对非遗文创产品视觉元素的差异化感知。',
        '熵权法可以根据指标离散程度进行客观赋权，从而减少单纯依赖主观判断造成的排序偏差。',
        '问卷调查能够把用户态度转化为可比较的测量结果，为后续模型分析提供数据基础。',
      ].join('\n\n'),
    },
    {
      id: 's4',
      title: '四、数据分析与研究结果',
      content: [
        '结果显示，视觉识别、文化认同和互动体验均会影响青年用户对非遗文创产品的评价。',
        '排名靠前的指标说明用户不仅关注产品外观，也关注文化符号是否能够被准确理解和情感化表达。',
        '从传播效果看，社交平台中的互动机制会进一步影响用户的分享意愿和持续关注行为。',
      ].join('\n\n'),
    },
  ]
  const reliableSources = [
    {
      id: 'src_kano',
      title: 'KANO Model and Customer Satisfaction Classification',
      authors: ['Kano Noriaki'],
      year: 1984,
      journal: 'Journal of Quality Management',
      doi: '10.0000/kano-model',
      abstract: 'The KANO model classifies product requirements into must-be, one-dimensional and attractive qualities for customer satisfaction analysis.',
    },
    {
      id: 'src_entropy',
      title: 'Entropy Weight Method for Objective Indicator Weighting',
      authors: ['Shannon Claude', 'Wang Li'],
      year: 2021,
      url: 'https://example.org/entropy-weight-method',
      abstract: 'Entropy weight method uses dispersion of indicators to calculate objective weights and support ranking decisions.',
    },
    {
      id: 'src_ich_visual',
      title: 'Intangible Cultural Heritage Visual Symbols and Media Communication',
      authors: ['Zhang Ming'],
      year: 2022,
      url: 'https://example.org/ich-visual-symbols',
      abstract: 'Research on intangible cultural heritage visual symbols shows that cultural context, user emotion and media presentation affect communication value.',
    },
    {
      id: 'src_youth_media',
      title: 'Youth Cultural Media Interaction and Sharing Intention',
      authors: ['Chen Yu', 'Liu Fang'],
      year: 2023,
      url: 'https://example.org/youth-cultural-media',
      abstract: 'Youth users sharing intention is affected by emotional resonance, interaction mechanism and platform-based media presentation.',
    },
  ]

  const noSource = await requestJson('POST', '/api/references/enhance', {
    sections,
    sources: [{ id: 'bad', title: '作者缺失的来源', url: 'https://example.org/bad-source' }],
    minPatchCount: 2,
  }, token)
  assert(noSource.ok === true, 'no-source response should be ok')
  assert((noSource.patches ?? []).length === 0, 'unreliable sources should not produce citation patches')
  assert(String(noSource.auditNote ?? '').length > 0, 'no-source response should explain why no patches were produced')

  const unrelated = await requestJson('POST', '/api/references/enhance', {
    sections,
    sources: [
      {
        id: 'src_unrelated_planets',
        title: 'Orbital Resonance in Exoplanetary Systems',
        authors: ['Rivera Ana'],
        year: 2020,
        url: 'https://example.org/exoplanet-orbital-resonance',
        abstract: 'This astronomy paper discusses orbital periods, planetary migration and resonance chains in extrasolar systems.',
      },
      {
        id: 'src_unrelated_battery',
        title: 'Lithium Battery Thermal Management Materials',
        authors: ['Smith Alex'],
        year: 2021,
        doi: '10.0000/battery-thermal-materials',
        abstract: 'This engineering paper studies heat transfer, phase-change materials and cooling channels for lithium battery packs.',
      },
    ],
    minPatchCount: 2,
  }, token)
  assert(unrelated.ok === true, 'unrelated-source response should be ok')
  assert((unrelated.patches ?? []).length === 0, 'reliable but unrelated sources should not produce citation patches')

  const methodMismatch = await requestJson('POST', '/api/references/enhance', {
    sections: [
      {
        id: 'method-kano',
        title: 'Method grounding',
        content: 'The KANO model is used to classify user requirements into must-be, one-dimensional and attractive categories before prioritizing design elements.',
      },
      {
        id: 'method-entropy',
        title: 'Weighting method',
        content: 'Entropy weight method calculates objective indicator weights according to dispersion and is used to reduce subjective ranking bias.',
      },
    ],
    sources: [
      {
        id: 'src_entropy_only',
        title: 'Entropy Weight Method for Objective Indicator Weighting',
        authors: ['Wang Li'],
        year: 2021,
        url: 'https://example.org/entropy-weight-method-only',
        abstract: 'Entropy weight method calculates objective weights from indicator dispersion and supports ranking decisions.',
      },
      {
        id: 'src_kano_only',
        title: 'KANO Model and Customer Satisfaction Classification',
        authors: ['Kano Noriaki'],
        year: 1984,
        doi: '10.0000/kano-model-only',
        abstract: 'The KANO model classifies requirements into must-be, one-dimensional and attractive qualities.',
      },
    ],
    minPatchCount: 2,
    idealPatchCount: 2,
  }, token)
  assert(methodMismatch.ok === true, 'method-mismatch response should be ok')
  assertPatchQuality(methodMismatch.patches ?? [], 2)
  for (const patch of methodMismatch.patches ?? []) {
    const text = String(patch.originalText ?? '')
    if (/KANO/i.test(text)) assert(patch.source.id === 'src_kano_only', 'KANO claim should only bind to a KANO source')
    if (/Entropy/i.test(text)) assert(patch.source.id === 'src_entropy_only', 'entropy claim should only bind to an entropy source')
  }

  const enhanced = await requestJson('POST', '/api/references/enhance', {
    projectTitle: '非遗文创视觉元素魅力识别研究',
    researchObject: '非遗文创产品视觉元素与青年用户评价',
    sections,
    sources: reliableSources,
    minPatchCount: 4,
    idealPatchCount: 6,
    targetFinalCitationCount: 24,
  }, token)
  assert(enhanced.ok === true, 'production citation enhancement response should be ok')
  const coverage = assertPatchQuality(enhanced.patches ?? [], 4)

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    noSourcePatchCount: noSource.patches?.length ?? 0,
    unrelatedPatchCount: unrelated.patches?.length ?? 0,
    methodMismatchPatchCount: methodMismatch.patches?.length ?? 0,
    patchCount: enhanced.patches?.length ?? 0,
    auditNote: enhanced.auditNote,
    skipped: enhanced.skipped ?? [],
    coverage,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
