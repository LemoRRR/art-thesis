import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { applyCitationsToContent } from '../src/lib/citations.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function textFromXml(xml) {
  return Array.from(xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
}

async function inspectDocxFootnotes(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  const footnotesXml = await zip.file('word/footnotes.xml')?.async('string')
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string')
  assert(documentXml, 'DOCX 缺少 word/document.xml')
  assert(footnotesXml, 'DOCX 缺少 word/footnotes.xml')
  assert(relsXml, 'DOCX 缺少 document.xml.rels')
  assert(contentTypesXml, 'DOCX 缺少 [Content_Types].xml')

  const bodyText = textFromXml(documentXml)
  const footnoteText = textFromXml(footnotesXml)
  return {
    bodyText,
    footnoteText,
    bodyReferenceCount: (documentXml.match(/<w:footnoteReference\b/g) ?? []).length,
    footnoteCount: (footnotesXml.match(/<w:footnote\b/g) ?? []).length,
    hasFootnotesRelationship: /Type="[^"]+\/footnotes"/.test(relsXml),
    hasFootnotesContentType: /PartName="\/word\/footnotes\.xml"/.test(contentTypesXml),
    leakedInternalMarkers: /\{\{cite:|S1|S2/.test(bodyText),
    plainBracketCitations: /\[[12]\]/.test(bodyText),
  }
}

async function main() {
  const outputPath = path.resolve(process.argv[2] || '../outputs/ich_kano_entropy/citation-docx-smoke.docx')
  const rawContent = [
    '国内关于非遗视觉传播的研究指出，传统文化符号只有进入具体媒介语境，才能形成稳定的意义识别与传播价值。{{cite:S1}}',
    '在青年用户研究中，互动机制与情感共鸣通常会影响用户的持续关注和分享意愿。{{cite:S2}}',
  ].join('\n\n')
  const sources = [
    {
      key: 'S1',
      title: '非遗视觉传播研究',
      noteText: '张明. 非遗视觉传播研究. 艺术传播研究, 2022. 该文讨论传统文化符号在媒介语境中的意义建构。',
    },
    {
      key: 'S2',
      title: '青年用户传播意愿研究',
      noteText: 'Li, H. Youth engagement and sharing intention in cultural media. Journal of Cultural Communication, 2023. https://example.org/youth-cultural-media',
    },
  ]
  const finalized = applyCitationsToContent(rawContent, sources, 1)
  assert(finalized.footnotes.length === 2, `脚注数量不正确：${finalized.footnotes.length}`)
  assert(
    JSON.stringify(finalized.footnotes.map(footnote => footnote.number)) === JSON.stringify([1, 2]),
    `脚注编号应从 1 连续生成：${finalized.footnotes.map(footnote => footnote.number).join(',')}`
  )
  assert(!finalized.content.includes('{{cite:'), '正文仍包含内部引用标记')
  assert(finalized.footnotes.every(footnote => footnote.anchorText && footnote.noteText), '脚注缺少锚点或说明文本')

  const continued = applyCitationsToContent(rawContent, sources, 5)
  assert(
    JSON.stringify(continued.footnotes.map(footnote => footnote.number)) === JSON.stringify([5, 6]),
    `跨章节继续生成时不应把 S1/S2 重置成 1/2：${continued.footnotes.map(footnote => footnote.number).join(',')}`
  )
  const sameParagraph = applyCitationsToContent(
    'KANO模型可以识别用户需求属性。{{cite:S1}} 熵权法则可用于指标客观赋权。{{cite:S2}}',
    sources,
    3
  )
  assert(
    JSON.stringify(sameParagraph.footnotes.map(footnote => footnote.number)) === JSON.stringify([3, 4]),
    `同段多个引用应按正文顺序连续编号：${sameParagraph.footnotes.map(footnote => footnote.number).join(',')}`
  )

  const sections = [
    {
      id: 'citation-smoke-section',
      projectId: 'citation-smoke',
      title: '四、文献依据与观点校准',
      content: finalized.content,
      footnotes: finalized.footnotes,
      status: 'done',
      lastModified: Date.now(),
      order: 4,
    },
  ]
  const blob = await buildSectionsDocxBlob('引用脚注导出烟测', sections)
  const buffer = Buffer.from(await blob.arrayBuffer())
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, buffer)

  const docx = await inspectDocxFootnotes(buffer)
  assert(docx.bodyReferenceCount === 2, `正文 footnoteReference 数量不正确：${docx.bodyReferenceCount}`)
  assert(docx.footnoteCount >= 2, `footnotes.xml 中脚注数量不足：${docx.footnoteCount}`)
  assert(docx.hasFootnotesRelationship, 'DOCX 缺少 footnotes relationship')
  assert(docx.hasFootnotesContentType, 'DOCX 缺少 footnotes content type')
  assert(!docx.leakedInternalMarkers, '正文泄漏内部引用标记或 S 编号')
  assert(!docx.plainBracketCitations, '正文仍使用普通 [n] 文本，而不是真实 Word 脚注引用')
  assert(docx.footnoteText.includes('非遗视觉传播研究'), '脚注缺少中文来源说明')
  assert(docx.footnoteText.includes('https://example.org/youth-cultural-media'), '脚注缺少 URL 来源说明')

  console.log(JSON.stringify({
    ok: true,
    outputPath,
    footnoteCount: finalized.footnotes.length,
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
