import express from 'express'
import referencesRouter from '../server/routes/references.ts'
import { listenOnSafePort } from './smoke-server.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function post(base, route, body) {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok === false) {
    throw new Error(`${route} ${res.status}: ${JSON.stringify(json).slice(0, 1000)}`)
  }
  return json
}

function assertPatchQuality(patches, expectedMin) {
  assert(Array.isArray(patches), 'patches must be an array')
  assert(patches.length >= expectedMin, `expected at least ${expectedMin} citation patches, got ${patches.length}`)
  for (const patch of patches) {
    assert(patch.sectionId, 'patch is missing sectionId')
    assert(patch.originalText && patch.revisedText, 'patch is missing replacement text')
    assert(patch.source?.id && patch.source?.title, 'patch is missing bound source metadata')
    assert(Array.isArray(patch.source.authors) && patch.source.authors.length > 0, 'patch source is missing authors')
    assert(patch.source.doi || patch.source.url, 'patch source is missing DOI/URL')
    assert(!/\{\{cite:|\[[0-9,\s]+\]|(?:^|[^\w])S\d+(?:[^\w]|$)/i.test(patch.revisedText), 'patch leaked inline citation marker')
    assert(patch.applyMode === 'citation_only' || patch.applyMode === 'rewrite_with_citation', `unexpected applyMode: ${patch.applyMode}`)
  }
}

async function main() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/references', referencesRouter)
  const { server, port } = await listenOnSafePort(app)
  const base = `http://127.0.0.1:${port}`

  try {
    const sections = [
      {
        id: 's2',
        title: '二、理论基础与研究方法',
        content: [
          'KANO模型能够区分必备型、期望型和魅力型需求，因此适合用于识别用户对非遗文创产品视觉元素的差异化感知。',
          '熵权法可以根据指标离散程度进行客观赋权，从而减少单纯依赖主观判断造成的排序偏差。',
          '非遗视觉符号的传播效果不仅取决于图案本身，也取决于文化语境、用户情感和媒介呈现方式。',
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
    ]

    const noSource = await post(base, '/api/references/enhance', {
      sections,
      sources: [{ id: 'bad', title: '作者缺失的来源', url: 'https://example.org/bad-source' }],
      minPatchCount: 2,
      fallbackOnly: true,
    })
    assert(noSource.ok === true, 'no-source response should be ok')
    assert((noSource.patches ?? []).length === 0, 'unreliable sources should not produce citation patches')
    assert(String(noSource.auditNote ?? '').length > 0, 'no-source response should explain why no patches were produced')

    const fallback = await post(base, '/api/references/enhance', {
      projectTitle: '非遗文创视觉元素魅力识别研究',
      sections,
      sources: reliableSources,
      minPatchCount: 3,
      fallbackOnly: true,
    })
    assert(fallback.ok === true, 'fallback citation response should be ok')
    assertPatchQuality(fallback.patches ?? [], 3)
    const sourceIds = (fallback.patches ?? []).map(patch => patch.source.id)
    for (const expected of ['src_kano', 'src_entropy', 'src_ich_visual']) {
      assert(sourceIds.includes(expected), `fallback citation patches did not include expected source: ${expected}`)
    }

    console.log(JSON.stringify({
      ok: true,
      noSourcePatchCount: noSource.patches?.length ?? 0,
      fallbackPatchCount: fallback.patches?.length ?? 0,
      sourceIds,
    }, null, 2))
  } finally {
    server.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
