import mammoth from 'mammoth'
import { createRequire } from 'node:module'

type PDFParseConstructor = new (input: { data: Buffer }) => {
  getText: () => Promise<{ text: string }>
  destroy: () => Promise<void>
}

const requirePdfParse = createRequire(import.meta.url)

function loadPdfParser(): PDFParseConstructor {
  const { PDFParse } = requirePdfParse('pdf-parse') as {
  PDFParse: new (input: { data: Buffer }) => {
    getText: () => Promise<{ text: string }>
    destroy: () => Promise<void>
  }
}
  return PDFParse
}

function cleanParsedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{3,}/g, ' ')
    .trim()
}

export async function parseFile(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase()

  try {
    if (ext === 'pdf') {
      const PDFParse = loadPdfParser()
      const parser = new PDFParse({ data: buffer })
      try {
        const result = await parser.getText()
        return cleanParsedText(result.text).slice(0, 80_000)
      } finally {
        await parser.destroy()
      }
    }

    if (ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ buffer })
      return cleanParsedText(result.value).slice(0, 80_000)
    }

    if (ext === 'txt') {
      return cleanParsedText(buffer.toString('utf-8')).slice(0, 80_000)
    }

    return `已上传文件：${fileName}（当前版本不支持该格式的内容提取）`
  } catch (error) {
    console.error('[Parser] 解析失败', fileName, error)
    return `文件解析失败：${fileName}`
  }
}
