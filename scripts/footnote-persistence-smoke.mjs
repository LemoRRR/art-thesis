import JSZip from 'jszip'

import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { paperDocToSections, paperTextToEditorDoc, sectionsToPaperDoc } from '../src/lib/editorDocument.ts'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function inspectDocx(blob) {
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()))
  const documentXml = await zip.file('word/document.xml')?.async('string')
  const footnotesXml = await zip.file('word/footnotes.xml')?.async('string')
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string')
  assert(documentXml, 'DOCX 缺少 word/document.xml')
  assert(footnotesXml, 'DOCX 缺少 word/footnotes.xml')
  assert(relsXml && /Type="[^"]+\/footnotes"/.test(relsXml), 'DOCX 缺少 footnotes relationship')
  assert(contentTypesXml && /PartName="\/word\/footnotes\.xml"/.test(contentTypesXml), 'DOCX 缺少 footnotes content type')
  return {
    bodyReferenceCount: (documentXml.match(/<w:footnoteReference\b/g) ?? []).length,
    footnoteCount: (footnotesXml.match(/<w:footnote\b/g) ?? []).length,
    hasSourceText: footnotesXml.includes('视觉文化研究') && footnotesXml.includes('2024'),
  }
}

async function main() {
  const section = {
    id: 'section-one',
    projectId: 'project-one',
    title: '研究背景',
    content: '国潮插画的视觉符号会影响青年用户的文化认同。',
    editorDoc: paperTextToEditorDoc('国潮插画的视觉符号会影响青年用户的文化认同。'),
    status: 'done',
    lastModified: Date.now(),
    order: 0,
    footnotes: [
      {
        id: 'fn-one',
        number: 1,
        blockIndex: 0,
        start: 0,
        end: 12,
        anchorText: '国潮插画的视觉符号',
        noteText: '张三：《视觉文化研究》，艺术设计研究，2024。',
      },
    ],
  }

  const paperDoc = sectionsToPaperDoc('测试论文', [section])
  assert(Array.isArray(paperDoc.attrs?.footnotes), '整篇 editor doc 没有保存 root footnotes')
  assert(paperDoc.attrs.footnotes.length === 1, 'root footnotes 数量不正确')

  const restored = paperDocToSections(paperDoc, [{ ...section, footnotes: undefined }])
  assert(restored.length === 1, '拆分后章节数量不正确')
  assert(restored[0].footnotes?.length === 1, '从 root footnotes 拆回章节时脚注丢失')
  assert(restored[0].footnotes?.[0]?.noteText.includes('视觉文化研究'), '拆回章节的脚注内容不正确')

  const blob = await buildSectionsDocxBlob('测试论文', restored)
  const docx = await inspectDocx(blob)
  assert(docx.bodyReferenceCount === 1, `正文脚注引用数量不正确：${docx.bodyReferenceCount}`)
  assert(docx.footnoteCount >= 1, `footnotes.xml 脚注数量不足：${docx.footnoteCount}`)
  assert(docx.hasSourceText, 'DOCX 脚注没有包含来源文本')

  console.log(JSON.stringify({
    ok: true,
    restoredFootnotes: restored[0].footnotes.length,
    docx,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
