import mammoth from 'mammoth'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>

export async function parseFile(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase()

  try {
    if (ext === 'pdf') {
      const result = await pdfParse(buffer)
      return result.text.slice(0, 50_000)
    }

    if (ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ buffer })
      return result.value.slice(0, 50_000)
    }

    if (ext === 'txt') {
      return buffer.toString('utf-8').slice(0, 50_000)
    }

    return `已上传文件：${fileName}（当前版本不支持该格式的内容提取）`
  } catch {
    return `文件解析失败：${fileName}`
  }
}
