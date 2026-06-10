import { Router } from 'express'
import multer from 'multer'
import { extractDimensions } from '../lib/extract.js'
import { parseFile } from '../lib/parser.js'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

function buildStorageKey(userId: string, originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '') || 'bin'
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${userId}/${id}.${ext}`
}

function decodeUploadFileName(fileName: string): string {
  try {
    const decoded = Buffer.from(fileName, 'latin1').toString('utf8')
    return decoded.includes('�') ? fileName : decoded
  } catch {
    return fileName
  }
}

router.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ error: '没有文件' })
    return
  }

  const file = req.file
  const db = createUserClient(req.accessToken!)
  const originalFileName = decodeUploadFileName(file.originalname)
  const fileName = buildStorageKey(req.userId!, originalFileName)
  const { error: uploadError } = await db.storage
    .from('library-files')
    .upload(fileName, file.buffer, { contentType: file.mimetype })

  if (uploadError) {
    console.error('[Files] Supabase Storage 上传失败', uploadError)
    res.status(500).json({ error: `文件上传失败：${uploadError.message}` })
    return
  }

  const { data: signedUrlData } = await db.storage
    .from('library-files')
    .createSignedUrl(fileName, 60 * 60)

  const textContent = await parseFile(file.buffer, originalFileName)
  const type = getFileType(originalFileName)
  const { data, error } = await db
    .from('library_items')
    .insert({
      user_id: req.userId,
      title: originalFileName.replace(/\.[^.]+$/, ''),
      type,
      file_name: originalFileName,
      file_size: file.size,
      file_url: signedUrlData?.signedUrl ?? '',
      text_content: textContent,
      summary: textContent.slice(0, 150),
      tags: [type.toUpperCase()],
      index_status: 'ready',
      extract_status: 'processing',
    })
    .select()
    .single()

  if (error) {
    console.error('[Files] library_items 写入失败', error)
    res.status(500).json({ error: error.message })
    return
  }

  extractDimensions(data.id, textContent, req.accessToken).catch(() => {
    // 已在 extractDimensions 内部记录并更新 failed 状态。
  })

  res.json(data)
})

function getFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'txt') return 'txt'
  return 'other'
}

export default router
