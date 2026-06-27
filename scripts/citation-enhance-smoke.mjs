import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import referencesRouter from '../server/routes/references.ts'
import { listenOnSafePort } from './smoke-server.mjs'
import { applyCitationPatchesToSections } from '../src/lib/citationPatches.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'

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
    sourceUseCounts.set(patch.source.id, (sourceUseCounts.get(patch.source.id) ?? 0) + 1)
  }
  assert(sourceUseCounts.size >= Math.min(3, expectedMin), `citation patches used too few distinct sources: ${sourceUseCounts.size}`)
  const maxSourceReuse = Math.max(...sourceUseCounts.values())
  assert(maxSourceReuse <= Math.ceil(patches.length / 2), `one source is overused across citation patches: ${maxSourceReuse}/${patches.length}`)
}

function textFromXml(xml) {
  return Array.from(xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
}

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  const footnotesXml = await zip.file('word/footnotes.xml')?.async('string')
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string')
  assert(documentXml, 'enhanced citation DOCX is missing word/document.xml')
  assert(footnotesXml, 'enhanced citation DOCX is missing word/footnotes.xml')
  assert(relsXml, 'enhanced citation DOCX is missing document relationship file')
  assert(contentTypesXml, 'enhanced citation DOCX is missing content types file')
  return {
    bodyText: textFromXml(documentXml),
    footnoteText: textFromXml(footnotesXml),
    bodyReferenceCount: (documentXml.match(/<w:footnoteReference\b/g) ?? []).length,
    hasFootnotesRelationship: /Type="[^"]+\/footnotes"/.test(relsXml),
    hasFootnotesContentType: /PartName="\/word\/footnotes\.xml"/.test(contentTypesXml),
  }
}

function citationNoteText(source) {
  const authors = Array.isArray(source?.authors) ? source.authors.join(', ') : ''
  const year = source?.year ? ` (${source.year})` : ''
  const title = source?.title ?? 'Untitled source'
  const venue = source?.journal || source?.publisher || source?.provider || ''
  const locator = source?.doi ? ` DOI: ${source.doi}` : source?.url ? ` ${source.url}` : ''
  return [authors ? `${authors}${year}.` : '', title, venue, locator]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
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

    const unrelated = await post(base, '/api/references/enhance', {
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
      fallbackOnly: true,
    })
    assert(unrelated.ok === true, 'unrelated-source response should be ok')
    assert((unrelated.patches ?? []).length === 0, 'reliable but unrelated sources should not produce citation patches')

    const methodMismatch = await post(base, '/api/references/enhance', {
      sections: [
        {
          id: 'mismatch-kano',
          title: 'Method grounding',
          content: 'The KANO model is used to classify user requirements into must-be, one-dimensional and attractive categories before prioritizing design elements.',
        },
        {
          id: 'mismatch-entropy',
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
      fallbackOnly: true,
    })
    assert(methodMismatch.ok === true, 'method-mismatch response should be ok')
    assertPatchQuality(methodMismatch.patches ?? [], 2)
    for (const patch of methodMismatch.patches ?? []) {
      const text = String(patch.originalText ?? '')
      if (/KANO/i.test(text)) assert(patch.source.id === 'src_kano_only', 'KANO claim should only bind to a KANO source')
      if (/Entropy/i.test(text)) assert(patch.source.id === 'src_entropy_only', 'entropy claim should only bind to an entropy source')
    }

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

    const docSections = sections.map((section, index) => ({
      id: section.id,
      projectId: 'citation-enhance-smoke',
      title: section.title,
      content: section.content,
      status: 'done',
      lastModified: Date.now(),
      order: index + 1,
    }))
    const citationPatchInputs = (fallback.patches ?? []).map(patch => ({
      sectionId: patch.sectionId,
      originalText: patch.originalText,
      revisedText: patch.revisedText,
      source: {
        noteText: citationNoteText(patch.source),
      },
    }))
    const applied = applyCitationPatchesToSections(docSections, citationPatchInputs, { now: () => 123456 })
    assert(applied.appliedCount >= 3, `expected citation enhance patches to be applied to sections, got ${applied.appliedCount}`)
    const citedSection = applied.sections.find(section => section.id === 's2')
    assert(citedSection?.footnotes?.length >= 3, `expected enhanced section footnotes, got ${citedSection?.footnotes?.length ?? 0}`)
    assert(
      citedSection.footnotes.every(footnote => /Kano|Entropy|Intangible|Heritage|Visual|Shannon|Zhang/i.test(footnote.noteText)),
      'enhanced footnotes do not preserve source identity'
    )

    const outputPath = path.resolve('../outputs/ich_kano_entropy/citation-enhance-docx-smoke.docx')
    const blob = await buildSectionsDocxBlob('Citation enhance smoke', applied.sections)
    const buffer = Buffer.from(await blob.arrayBuffer())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, buffer)
    const docx = await inspectDocx(buffer)
    assert(docx.bodyReferenceCount >= 3, `expected at least 3 Word footnote refs, got ${docx.bodyReferenceCount}`)
    assert(docx.hasFootnotesRelationship, 'enhanced DOCX lacks footnotes relationship')
    assert(docx.hasFootnotesContentType, 'enhanced DOCX lacks footnotes content type')
    assert(!docx.bodyText.includes('{{cite:'), 'internal citation marker leaked into enhanced DOCX body')
    assert(!/\[[0-9,\s]+\]/.test(docx.bodyText), 'plain bracket citation leaked into enhanced DOCX body')
    assert(/Kano|Entropy|Intangible|Heritage|Visual|Shannon|Zhang/i.test(docx.footnoteText), 'enhanced DOCX footnotes lack source metadata')

    console.log(JSON.stringify({
      ok: true,
      noSourcePatchCount: noSource.patches?.length ?? 0,
      unrelatedPatchCount: unrelated.patches?.length ?? 0,
      fallbackPatchCount: fallback.patches?.length ?? 0,
      sourceIds,
      docx: {
        outputPath,
        bodyReferenceCount: docx.bodyReferenceCount,
        hasFootnotesRelationship: docx.hasFootnotesRelationship,
        hasFootnotesContentType: docx.hasFootnotesContentType,
      },
    }, null, 2))
  } finally {
    server.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
