import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { applyCitationPatchesToSections } from '../src/lib/citationPatches.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'

function assert(condition, message) {
  if (!condition) throw new Error(message)
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
  assert(documentXml, 'DOCX is missing word/document.xml')
  assert(footnotesXml, 'DOCX is missing word/footnotes.xml')
  assert(relsXml, 'DOCX is missing document relationship file')
  assert(contentTypesXml, 'DOCX is missing content types file')
  return {
    documentXml,
    footnotesXml,
    bodyText: textFromXml(documentXml),
    footnoteText: textFromXml(footnotesXml),
    bodyReferenceCount: (documentXml.match(/<w:footnoteReference\b/g) ?? []).length,
    footnoteCount: (footnotesXml.match(/<w:footnote\b/g) ?? []).length,
    hasFootnotesRelationship: /Type="[^"]+\/footnotes"/.test(relsXml),
    hasFootnotesContentType: /PartName="\/word\/footnotes\.xml"/.test(contentTypesXml),
  }
}

async function main() {
  const outputPath = path.resolve(process.argv[2] || '../outputs/ich_kano_entropy/citation-patch-docx-smoke.docx')
  const sections = [
    {
      id: 'intro',
      projectId: 'citation-patch-smoke',
      title: 'Introduction',
      content: 'Reference list placeholder should not be patched.',
      status: 'done',
      lastModified: Date.now(),
      order: 1,
    },
    {
      id: 'body',
      projectId: 'citation-patch-smoke',
      title: 'Findings',
      content: [
        'KANO analysis identifies how product features influence user satisfaction.',
        'Entropy weighting can reduce subjective bias when combining multiple indicators.',
      ].join('\n\n'),
      status: 'done',
      lastModified: Date.now(),
      order: 2,
    },
    {
      id: 'refs',
      projectId: 'citation-patch-smoke',
      title: 'References',
      content: 'KANO analysis identifies how product features influence user satisfaction.',
      status: 'done',
      lastModified: Date.now(),
      order: 3,
    },
  ]

  const patches = [
    {
      sectionId: 'body',
      originalText: 'KANO analysis identifies how product features influence user satisfaction.',
      revisedText: 'KANO analysis classifies product features by their asymmetric effects on user satisfaction.',
      source: {
        noteText: 'Kano, N. Attractive quality and must-be quality. Journal of the Japanese Society for Quality Control, 1984.',
      },
    },
    {
      sectionId: 'body',
      originalText: 'Entropy weighting can reduce subjective bias when combining multiple indicators.',
      revisedText: '',
      source: {
        noteText: 'Shannon, C. E. A mathematical theory of communication. Bell System Technical Journal, 1948.',
      },
    },
    {
      sectionId: 'refs',
      originalText: 'KANO analysis identifies how product features influence user satisfaction.',
      revisedText: 'This reference section must remain untouched.',
      source: {
        noteText: 'This source should not be inserted into a non-body section.',
      },
    },
  ]

  const firstRun = applyCitationPatchesToSections(sections, patches, { now: () => 123456 })
  assert(firstRun.appliedCount === 2, `expected 2 applied patches, got ${firstRun.appliedCount}`)
  const body = firstRun.sections.find(section => section.id === 'body')
  const refs = firstRun.sections.find(section => section.id === 'refs')
  assert(body?.content.includes('asymmetric effects'), 'body claim was not rewritten')
  assert(body?.footnotes?.length === 2, `expected 2 body footnotes, got ${body?.footnotes?.length ?? 0}`)
  assert(JSON.stringify(body.footnotes.map(item => item.number)) === JSON.stringify([1, 2]), 'footnote numbers are not sequential')
  assert(refs?.content.includes('KANO analysis identifies'), 'reference section should not be rewritten')
  assert(!refs?.footnotes?.length, 'reference section should not receive footnotes')

  const secondRun = applyCitationPatchesToSections(firstRun.sections, patches, { now: () => 123457 })
  assert(secondRun.appliedCount === 0, `duplicate patches should not be applied, got ${secondRun.appliedCount}`)
  const secondBody = secondRun.sections.find(section => section.id === 'body')
  assert(secondBody?.footnotes?.length === 2, 'duplicate run changed footnote count')

  const blob = await buildSectionsDocxBlob('Citation patch smoke', secondRun.sections)
  const buffer = Buffer.from(await blob.arrayBuffer())
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, buffer)

  const docx = await inspectDocx(buffer)
  assert(docx.bodyReferenceCount === 2, `expected 2 Word footnote refs, got ${docx.bodyReferenceCount}`)
  assert(docx.footnoteCount >= 2, `expected footnotes.xml entries, got ${docx.footnoteCount}`)
  assert(docx.hasFootnotesRelationship, 'DOCX lacks footnotes relationship')
  assert(docx.hasFootnotesContentType, 'DOCX lacks footnotes content type')
  assert(docx.bodyText.includes('asymmetric effects'), 'DOCX body lacks rewritten claim')
  assert(!docx.bodyText.includes('{{cite:'), 'internal citation marker leaked into DOCX body')
  assert(!/\[[12]\]/.test(docx.bodyText), 'plain bracket citation leaked into DOCX body')
  assert(docx.footnoteText.includes('Kano') && docx.footnoteText.includes('Shannon'), 'DOCX footnotes lack source notes')

  console.log(JSON.stringify({
    ok: true,
    outputPath,
    appliedCount: firstRun.appliedCount,
    duplicateRunAppliedCount: secondRun.appliedCount,
    docx: {
      bodyReferenceCount: docx.bodyReferenceCount,
      footnoteCount: docx.footnoteCount,
      hasFootnotesRelationship: docx.hasFootnotesRelationship,
      hasFootnotesContentType: docx.hasFootnotesContentType,
    },
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
